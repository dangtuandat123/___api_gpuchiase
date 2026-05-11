/**
 * GET /api/v1/models
 *
 * Returns the list of models available from this provider.
 * ChiaseGPU calls this endpoint via "Tự động lấy danh sách model".
 * Format follows the OpenAI List Models API.
 */

import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    object: "list",
    data: [
      {
        id: "flux-2-klein-9b",
        object: "model",
        created: 1737590400, // 2026-01-23 — FLUX.2 klein 9B release date
        owned_by: "black-forest-labs",
      },
    ],
  });
}
