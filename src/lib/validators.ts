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
