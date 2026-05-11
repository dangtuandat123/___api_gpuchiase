/**
 * GET /api/health
 *
 * Health check endpoint for ChiaseGPU provider monitoring.
 * ChiaseGPU checks provider health every 5 minutes.
 * Returns 200 if all systems are operational, 503 otherwise.
 */

import { NextResponse } from "next/server";
import { checkHealth as checkSupabaseHealth } from "@/lib/supabase";

export async function GET() {
  const checks = {
    apiKeyConfigured: !!process.env.RUNWARE_API_KEY,
    dbConfigured: !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY),
    dbConnected: false,
  };

  // Only check DB connectivity if configured
  if (checks.dbConfigured) {
    checks.dbConnected = await checkSupabaseHealth();
  }

  const allHealthy = checks.apiKeyConfigured && (!checks.dbConfigured || checks.dbConnected);

  // Only expose minimal info externally
  return NextResponse.json(
    {
      status: allHealthy ? "healthy" : "unhealthy",
      timestamp: new Date().toISOString(),
    },
    { status: allHealthy ? 200 : 503 },
  );
}

