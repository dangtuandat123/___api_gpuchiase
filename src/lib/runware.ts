/**
 * Runware API client.
 * Calls the Runware HTTP REST API with retry logic (exponential backoff)
 * for transient errors (429, 503, 5xx).
 */

import type { RunwareTask, RunwareEditTask, RunwareImageResult } from "./transform";
import { UpstreamError, RateLimitError, InternalError } from "./errors";

const RUNWARE_API_URL = "https://api.runware.ai/v1";
const MAX_RETRIES = 3;
const REQUEST_TIMEOUT_MS = 45_000; // 45s timeout per attempt

interface RunwareSuccessResponse {
  data: RunwareImageResult[];
}

interface RunwareErrorEntry {
  code: string;
  message: string;
  parameter?: string;
  taskType?: string;
  taskUUID?: string;
}

interface RunwareErrorResponse {
  errors: RunwareErrorEntry[];
}

/**
 * Send image inference tasks to the Runware API.
 * Implements exponential backoff retry for transient errors.
 *
 * @param tasks - Array of RunwareTask payloads
 * @returns Array of RunwareImageResult
 * @throws ApiError on persistent failure
 */
export async function callRunwareAPI(tasks: (RunwareTask | RunwareEditTask)[]): Promise<RunwareImageResult[]> {
  const apiKey = process.env.RUNWARE_API_KEY;
  if (!apiKey) {
    throw new InternalError("RUNWARE_API_KEY is not configured.");
  }

  let lastError: Error | null = null;
  let lastStatusCode: number | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      const response = await fetch(RUNWARE_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(tasks),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      // Retryable status codes
      if (response.status === 429 || response.status >= 500) {
        lastStatusCode = response.status;
        const delay = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
        console.warn(
          `[runware] Attempt ${attempt + 1}/${MAX_RETRIES} failed with ${response.status}, retrying in ${delay}ms...`,
        );
        await sleep(delay);
        continue;
      }

      // Client errors (400, 401, 402, etc.) — do not retry
      if (!response.ok) {
        const errorBody = await response.json().catch(() => null) as RunwareErrorResponse | null;
        const errorMsg = errorBody?.errors?.[0]?.message ?? `Runware API returned ${response.status}`;

        if (response.status === 401) {
          throw new InternalError("Runware API key is invalid or expired.");
        }
        if (response.status === 402) {
          throw new UpstreamError("Runware account has insufficient balance.");
        }
        throw new UpstreamError(errorMsg);
      }

      // Success
      const body = (await response.json()) as RunwareSuccessResponse;

      if (!body.data || !Array.isArray(body.data)) {
        throw new UpstreamError("Runware API returned an unexpected response format.");
      }

      return body.data;
    } catch (err) {
      if (err instanceof UpstreamError || err instanceof InternalError || err instanceof RateLimitError) {
        throw err; // Don't retry known non-transient errors
      }

      lastError = err as Error;

      // AbortError = timeout
      if ((err as Error).name === "AbortError") {
        console.warn(`[runware] Attempt ${attempt + 1}/${MAX_RETRIES} timed out.`);
      } else {
        console.warn(`[runware] Attempt ${attempt + 1}/${MAX_RETRIES} failed:`, (err as Error).message);
      }

      if (attempt < MAX_RETRIES - 1) {
        const delay = Math.pow(2, attempt) * 1000;
        await sleep(delay);
      }
    }
  }

  // Forward 429 as RateLimitError so consumer SDK triggers auto-retry
  if (lastStatusCode === 429) {
    throw new RateLimitError(
      `Runware rate limit exceeded after ${MAX_RETRIES} retries. Please try again shortly.`,
    );
  }

  throw new UpstreamError(
    `Runware API failed after ${MAX_RETRIES} attempts: ${lastError?.message ?? "unknown error"}`,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
