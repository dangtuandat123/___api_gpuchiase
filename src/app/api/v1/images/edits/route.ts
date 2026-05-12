/**
 * POST /api/v1/images/edits
 *
 * OpenAI Images Edits API compatible endpoint.
 * Receives image edit requests (multipart/form-data) from ChiaseGPU consumers,
 * converts the uploaded image(s) to reference images for FLUX.2 Klein 9B,
 * proxies to Runware API, and returns results in OpenAI format.
 *
 * FLUX Klein 9B uses `inputs.referenceImages` (not seedImage/maskImage)
 * for its image editing capability. The model interprets the reference images
 * alongside the prompt to generate the edited output.
 */

import { NextRequest, NextResponse } from "next/server";
import { validateEditRequest } from "@/lib/validators";
import { openaiEditToRunware, runwareToOpenai } from "@/lib/transform";
import { callRunwareAPI } from "@/lib/runware";
import { logRequest } from "@/lib/supabase";
import { ApiError, AuthenticationError, InternalError } from "@/lib/errors";

/**
 * Verify the provider secret if configured.
 * Reuses the same auth pattern as the generations endpoint.
 */
function verifyAuth(request: NextRequest): void {
  const providerSecret = process.env.PROVIDER_SECRET;
  if (!providerSecret) return;

  const authHeader = request.headers.get("authorization");
  if (!authHeader) {
    throw new AuthenticationError("Missing Authorization header.");
  }

  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)
    : authHeader;

  if (token !== providerSecret) {
    throw new AuthenticationError("Invalid API key provided.");
  }
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  let sizeRequested = "auto";

  try {
    // 0. Verify provider auth
    verifyAuth(request);

    // 1. Parse multipart form data
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      throw new ApiError(
        400,
        "invalid_request_error",
        null,
        "invalid_content_type",
        "Request must be multipart/form-data.",
      );
    }

    // 2. Extract fields
    const imageFile = formData.get("image") as File | null;
    const maskFile = formData.get("mask") as File | null;
    const prompt = formData.get("prompt") as string | null;
    const size = formData.get("size") as string | null;
    const n = formData.get("n") as string | null;
    const responseFormat = formData.get("response_format") as string | null;

    sizeRequested = size ?? "auto";

    // 3. Validate input (also converts files to Base64 DataURIs)
    const validated = await validateEditRequest(
      prompt,
      imageFile,
      maskFile,
      size,
      n,
      responseFormat,
    );

    // 4. Build Runware task with reference images
    const tasks = openaiEditToRunware(validated);

    // 5. Call Runware API
    const runwareResults = await callRunwareAPI(tasks);

    // 6. Validate results have expected data
    for (const result of runwareResults) {
      if (validated.responseFormat === "b64_json" && !result.imageBase64Data) {
        throw new InternalError("Runware did not return base64 image data.");
      }
      if (validated.responseFormat === "url" && !result.imageURL) {
        throw new InternalError("Runware did not return an image URL.");
      }
    }

    // 7. Build OpenAI response
    const host = request.headers.get("host") || "apigpuchiase.vercel.app";
    const protocol = host.includes("localhost") ? "http" : "https";
    const baseUrl = `${protocol}://${host}`;

    const openaiResponse = runwareToOpenai(runwareResults, validated.responseFormat, baseUrl);

    // 8. Log to Supabase (async, fire-and-forget)
    const totalCost = runwareResults.reduce((sum, r) => sum + (r.cost ?? 0), 0);
    logRequest({
      prompt: validated.prompt.slice(0, 2000),
      width: validated.width,
      height: validated.height,
      steps: 4,
      n: validated.n,
      size_requested: sizeRequested,
      request_type: "edit",
      runware_task_uuid: runwareResults[0]?.taskUUID ?? null,
      runware_cost_usd: totalCost || null,
      image_count: runwareResults.length,
      status: "success",
      latency_ms: Date.now() - startTime,
      consumer_ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    }).catch(() => {
      // Swallow logging errors — never break the response
    });

    return NextResponse.json(openaiResponse, { status: 200 });
  } catch (err) {
    const latency = Date.now() - startTime;

    if (err instanceof ApiError) {
      logRequest({
        prompt: "(error)",
        width: 0,
        height: 0,
        steps: 4,
        n: 1,
        size_requested: sizeRequested,
        request_type: "edit",
        status: "error",
        error_message: err.message.slice(0, 500),
        latency_ms: latency,
        consumer_ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      }).catch(() => {});

      return NextResponse.json(err.toJSON(), { status: err.statusCode });
    }

    // Unexpected error
    console.error("[edits] Unexpected error:", err);

    logRequest({
      prompt: "(error)",
      width: 0,
      height: 0,
      steps: 4,
      n: 1,
      size_requested: sizeRequested,
      request_type: "edit",
      status: "error",
      error_message: String(err).slice(0, 500),
      latency_ms: latency,
      consumer_ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    }).catch(() => {});

    const internal = new InternalError();
    return NextResponse.json(internal.toJSON(), { status: 500 });
  }
}
