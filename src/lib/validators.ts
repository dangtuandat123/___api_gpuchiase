/**
 * Input validation for OpenAI Images API requests.
 * Validates prompt, size, n, and response_format against
 * the supported resolutions from ChiaseGPU.
 */

import { InvalidRequestError } from "./errors";

/** All supported size strings and their pixel dimensions */
export const SUPPORTED_SIZES: Record<string, { width: number; height: number }> = {
  auto: { width: 1024, height: 1024 },
  "1024x1024": { width: 1024, height: 1024 },  // 1:1
  "832x1216": { width: 832, height: 1216 },    // 2:3
  "1216x832": { width: 1216, height: 832 },    // 3:2
  "896x1152": { width: 896, height: 1152 },    // 3:4
  "1152x896": { width: 1152, height: 896 },    // 4:3
  "896x1088": { width: 896, height: 1088 },    // 4:5
  "1088x896": { width: 1088, height: 896 },    // 5:4
  "768x1344": { width: 768, height: 1344 },    // 9:16
  "1344x768": { width: 1344, height: 768 },    // 16:9
  "1536x640": { width: 1536, height: 640 },    // 21:9
};

const SUPPORTED_SIZE_KEYS = Object.keys(SUPPORTED_SIZES);

export interface ValidatedRequest {
  prompt: string;
  negativePrompt?: string;
  width: number;
  height: number;
  n: number;
  responseFormat: "b64_json" | "url";
}

export interface RawGenerationRequest {
  model?: string;
  prompt?: string;
  negative_prompt?: string;
  n?: number;
  size?: string;
  quality?: string;
  response_format?: string;
}

/**
 * Validate and normalize an incoming OpenAI Images generation request.
 * Throws InvalidRequestError on any validation failure.
 */
export function validateGenerationRequest(body: RawGenerationRequest): ValidatedRequest {
  // --- prompt ---
  if (!body.prompt || typeof body.prompt !== "string") {
    throw new InvalidRequestError("'prompt' is required and must be a non-empty string.", "prompt", "missing_prompt");
  }
  const prompt = body.prompt.trim();
  if (prompt.length === 0) {
    throw new InvalidRequestError("'prompt' must not be empty.", "prompt", "empty_prompt");
  }
  if (prompt.length > 10000) {
    throw new InvalidRequestError(
      `'prompt' must be at most 10000 characters, got ${prompt.length}.`,
      "prompt",
      "prompt_too_long",
    );
  }

  // --- negative_prompt (non-standard but useful) ---
  let negativePrompt: string | undefined;
  if (body.negative_prompt && typeof body.negative_prompt === "string") {
    negativePrompt = body.negative_prompt.trim() || undefined;
  }

  // --- size ---
  const sizeStr = body.size ?? "auto";
  const dims = SUPPORTED_SIZES[sizeStr];
  if (!dims) {
    throw new InvalidRequestError(
      `Invalid size '${sizeStr}'. Supported sizes: ${SUPPORTED_SIZE_KEYS.join(", ")}`,
      "size",
      "invalid_size",
    );
  }

  // --- n ---
  const n = body.n ?? 1;
  if (!Number.isInteger(n) || n < 1 || n > 4) {
    throw new InvalidRequestError("'n' must be an integer between 1 and 4.", "n", "invalid_n");
  }

  // --- response_format ---
  const responseFormat = (body.response_format ?? "b64_json") as "b64_json" | "url";
  if (responseFormat !== "b64_json" && responseFormat !== "url") {
    throw new InvalidRequestError(
      "'response_format' must be 'b64_json' or 'url'.",
      "response_format",
      "invalid_response_format",
    );
  }

  return {
    prompt,
    negativePrompt,
    width: dims.width,
    height: dims.height,
    n,
    responseFormat,
  };
}

// ─── Image Edit validation ───

/**
 * Max file size per image. Vercel Serverless has a hard 4.5 MB limit
 * on the entire request body (multipart). With image + mask + other fields,
 * each individual file should stay well under this limit.
 * Runware also saves images at max 2048px — files larger than ~3MB
 * are typically unnecessary for editing workflows.
 */
const MAX_FILE_SIZE_BYTES = 4 * 1024 * 1024; // 4 MB per file
const MAX_TOTAL_FILE_SIZE_BYTES = 4 * 1024 * 1024; // 4 MB total for all files combined

export interface ValidatedEditRequest {
  prompt: string;
  imageDataUri: string;
  maskDataUri?: string;
  width: number;
  height: number;
  n: number;
  responseFormat: "b64_json" | "url";
}

/**
 * MIME types accepted for image uploads.
 * Includes application/octet-stream because gateways (like ChiaseGPU)
 * often strip the original Content-Type when forwarding multipart requests.
 * This matches OpenAI's behavior which also accepts octet-stream.
 */
const ACCEPTED_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
  "application/octet-stream",
]);

/**
 * Convert an uploaded File to a Base64 Data URI string.
 * Used to pass images to Runware via `inputs.referenceImages`.
 * Falls back to image/png for unknown MIME types (e.g. octet-stream).
 */
async function fileToDataUri(file: File): Promise<string> {
  const buffer = Buffer.from(await file.arrayBuffer());
  const base64 = buffer.toString("base64");
  // Use the actual type if it's a real image type, otherwise default to PNG
  const mimeType = file.type && file.type.startsWith("image/") ? file.type : "image/png";
  return `data:${mimeType};base64,${base64}`;
}

/**
 * Validate a single uploaded image file.
 * Checks type (image/* or octet-stream) and size (≤4 MB).
 */
function validateImageFile(file: File, fieldName: string): void {
  const fileType = file.type || "application/octet-stream";
  if (!fileType.startsWith("image/") && !ACCEPTED_IMAGE_TYPES.has(fileType)) {
    throw new InvalidRequestError(
      `'${fieldName}' must be an image file (received ${fileType}).`,
      fieldName,
      "invalid_file_type",
    );
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    throw new InvalidRequestError(
      `'${fieldName}' must be at most 4 MB (received ${(file.size / 1024 / 1024).toFixed(1)} MB).`,
      fieldName,
      "file_too_large",
    );
  }
}

/**
 * Validate and normalize an incoming OpenAI Images edit request.
 * Accepts multipart/form-data fields and converts files to Base64 Data URIs.
 * Throws InvalidRequestError on any validation failure.
 */
export async function validateEditRequest(
  prompt: string | null,
  imageFile: File | null,
  maskFile: File | null,
  size: string | null,
  n: string | null,
  responseFormat: string | null,
): Promise<ValidatedEditRequest> {
  // --- prompt ---
  if (!prompt || typeof prompt !== "string" || prompt.trim().length === 0) {
    throw new InvalidRequestError("'prompt' is required and must be a non-empty string.", "prompt", "missing_prompt");
  }
  const trimmedPrompt = prompt.trim();
  if (trimmedPrompt.length > 10000) {
    throw new InvalidRequestError(
      `'prompt' must be at most 10000 characters, got ${trimmedPrompt.length}.`,
      "prompt",
      "prompt_too_long",
    );
  }

  // --- image (required) ---
  if (!imageFile || !(imageFile instanceof File) || imageFile.size === 0) {
    throw new InvalidRequestError("'image' is required and must be a non-empty image file.", "image", "missing_image");
  }
  validateImageFile(imageFile, "image");

  // --- mask (optional) ---
  let maskFile_: File | null = null;
  if (maskFile && maskFile instanceof File && maskFile.size > 0) {
    validateImageFile(maskFile, "mask");
    maskFile_ = maskFile;
  }

  // --- total size check (Vercel 4.5MB body limit) ---
  const totalFileSize = imageFile.size + (maskFile_?.size ?? 0);
  if (totalFileSize > MAX_TOTAL_FILE_SIZE_BYTES) {
    throw new InvalidRequestError(
      `Total file size must be at most 4 MB. ` +
      `Got image=${(imageFile.size / 1024 / 1024).toFixed(1)} MB` +
      (maskFile_ ? ` + mask=${(maskFile_.size / 1024 / 1024).toFixed(1)} MB` : "") +
      ` = ${(totalFileSize / 1024 / 1024).toFixed(1)} MB total.`,
      "image",
      "payload_too_large",
    );
  }

  // --- convert files to Base64 DataURIs ---
  const imageDataUri = await fileToDataUri(imageFile);
  let maskDataUri: string | undefined;
  if (maskFile_) {
    maskDataUri = await fileToDataUri(maskFile_);
  }

  // --- size ---
  const sizeStr = size ?? "auto";
  const dims = SUPPORTED_SIZES[sizeStr];
  if (!dims) {
    throw new InvalidRequestError(
      `Invalid size '${sizeStr}'. Supported sizes: ${SUPPORTED_SIZE_KEYS.join(", ")}`,
      "size",
      "invalid_size",
    );
  }

  // --- n ---
  const nValue = n ? parseInt(n, 10) : 1;
  if (!Number.isInteger(nValue) || nValue < 1 || nValue > 4) {
    throw new InvalidRequestError("'n' must be an integer between 1 and 4.", "n", "invalid_n");
  }

  // --- response_format ---
  const format = (responseFormat ?? "b64_json") as "b64_json" | "url";
  if (format !== "b64_json" && format !== "url") {
    throw new InvalidRequestError(
      "'response_format' must be 'b64_json' or 'url'.",
      "response_format",
      "invalid_response_format",
    );
  }

  return {
    prompt: trimmedPrompt,
    imageDataUri,
    maskDataUri,
    width: dims.width,
    height: dims.height,
    n: nValue,
    responseFormat: format,
  };
}
