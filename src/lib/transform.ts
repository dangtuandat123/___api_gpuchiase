/**
 * Format conversion utilities:
 * - OpenAI Images request → Runware native payload
 * - Runware response → OpenAI Images response
 */

import { v4 as uuidv4 } from "uuid";
import type { ValidatedRequest } from "./validators";

// ─── Runware types ───

export interface RunwareTask {
  taskType: "imageInference";
  taskUUID: string;
  model: string;
  positivePrompt: string;
  negativePrompt?: string;
  width: number;
  height: number;
  steps: number;
  CFGScale: number;
  numberResults: number;
  outputType: "URL" | "base64Data" | "dataURI";
  outputFormat: "JPG" | "PNG" | "WEBP";
  includeCost: boolean;
}

export interface RunwareImageResult {
  taskType: "imageInference";
  taskUUID: string;
  imageUUID: string;
  imageURL?: string;
  imageBase64Data?: string;
  seed: number;
  cost?: number;
  NSFWContent?: boolean;
}

// ─── OpenAI response types ───

export interface OpenAIImagesResponse {
  created: number;
  data: Array<{
    b64_json?: string;
    url?: string;
    revised_prompt?: string | null;
  }>;
}

// ─── Constants ───

const RUNWARE_MODEL_ID = "runware:400@2";
const DEFAULT_STEPS = 4;
const DEFAULT_CFG_SCALE = 3.5;

// ─── Transform functions ───

/**
 * Convert a validated OpenAI Images request into a single Runware task.
 * Uses `numberResults` to request multiple images in one task (instead of
 * creating n separate tasks), reducing API overhead and latency.
 *
 * When consumer wants b64_json, we request `outputType: "base64Data"` so
 * Runware returns base64 data directly — no extra image fetch needed.
 */
export function openaiToRunware(req: ValidatedRequest): RunwareTask[] {
  return [{
    taskType: "imageInference" as const,
    taskUUID: uuidv4(),
    model: RUNWARE_MODEL_ID,
    positivePrompt: req.prompt,
    ...(req.negativePrompt ? { negativePrompt: req.negativePrompt } : {}),
    width: req.width,
    height: req.height,
    steps: DEFAULT_STEPS,
    CFGScale: DEFAULT_CFG_SCALE,
    numberResults: req.n,
    outputType: req.responseFormat === "b64_json" ? "base64Data" as const : "URL" as const,
    outputFormat: "PNG" as const,
    includeCost: true,
  }];
}

/**
 * Convert Runware results into OpenAI Images API response format.
 * Maps `imageBase64Data` → `b64_json` and `imageURL` → `url`
 * depending on what Runware returned.
 */
export function runwareToOpenai(
  results: RunwareImageResult[],
  responseFormat: "b64_json" | "url",
): OpenAIImagesResponse {
  return {
    created: Math.floor(Date.now() / 1000),
    data: results.map((r) => ({
      ...(responseFormat === "b64_json" && r.imageBase64Data
        ? { b64_json: r.imageBase64Data }
        : {}),
      ...(responseFormat === "url" && r.imageURL
        ? { url: r.imageURL }
        : {}),
      revised_prompt: null,
    })),
  };
}
