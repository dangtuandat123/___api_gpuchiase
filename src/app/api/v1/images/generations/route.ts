/**
 * POST /api/v1/images/generations
 *
 * Main endpoint — OpenAI Images API compatible.
 * Receives generation requests from ChiaseGPU consumers,
 * proxies to Runware API, and returns results in OpenAI format.
 */

import { NextRequest, NextResponse } from "next/server";
import { validateGenerationRequest } from "@/lib/validators";
import { openaiToRunware, runwareToOpenai } from "@/lib/transform";
import { callRunwareAPI } from "@/lib/runware";
import { logRequest } from "@/lib/supabase";
import { ApiError, AuthenticationError, InvalidRequestError, InternalError } from "@/lib/errors";

/**
 * Verify the provider secret if configured.
 * ChiaseGPU sends the provider API key in the Authorization header when
 * forwarding consumer requests. We validate it to prevent direct abuse.
 */
function verifyAuth(request: NextRequest): void {
  const providerSecret = process.env.PROVIDER_SECRET;
  if (!providerSecret) return; // No secret configured — skip auth (dev mode)

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

    // 1. Parse request body
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      throw new InvalidRequestError("Request body must be valid JSON.", null, "invalid_json");
    }

    sizeRequested = (body.size as string) ?? "auto";

    // 2. Validate input
    const validated = validateGenerationRequest(body);

    // 3. Build single Runware task (with numberResults for n images)
    const tasks = openaiToRunware(validated);

    // 4. Call Runware API
    const runwareResults = await callRunwareAPI(tasks);

    // 5. Validate results have expected data
    for (const result of runwareResults) {
      if (validated.responseFormat === "b64_json" && !result.imageBase64Data) {
        throw new InternalError("Runware did not return base64 image data.");
      }
      if (validated.responseFormat === "url" && !result.imageURL) {
        throw new InternalError("Runware did not return an image URL.");
      }
    }

    // 6. Build OpenAI response (direct mapping, no extra fetch needed)
    const host = request.headers.get("host") || "apigpuchiase.vercel.app";
    const protocol = host.includes("localhost") ? "http" : "https";
    const baseUrl = `${protocol}://${host}`;
    
    const openaiResponse = runwareToOpenai(runwareResults, validated.responseFormat, baseUrl);

    // 7. Log to Supabase (async, fire-and-forget)
    const totalCost = runwareResults.reduce((sum, r) => sum + (r.cost ?? 0), 0);
    logRequest({
      prompt: validated.prompt.slice(0, 2000),
      negative_prompt: validated.negativePrompt?.slice(0, 2000),
      width: validated.width,
      height: validated.height,
      steps: 4,
      n: validated.n,
      size_requested: sizeRequested,
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
        status: "error",
        error_message: err.message.slice(0, 500),
        latency_ms: latency,
        consumer_ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      }).catch(() => {});

      return NextResponse.json(err.toJSON(), { status: err.statusCode });
    }

    // Unexpected error
    console.error("[generations] Unexpected error:", err);

    logRequest({
      prompt: "(error)",
      width: 0,
      height: 0,
      steps: 4,
      n: 1,
      size_requested: sizeRequested,
      status: "error",
      error_message: String(err).slice(0, 500),
      latency_ms: latency,
      consumer_ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    }).catch(() => {});

    const internal = new InternalError();
    return NextResponse.json(internal.toJSON(), { status: 500 });
  }
}

