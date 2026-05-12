/**
 * Supabase client singleton and request logging.
 * Uses service role key for server-side inserts (no RLS).
 * Logging is fire-and-forget to avoid blocking API responses.
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;
let warnedMissing = false;

function getClient(): SupabaseClient | null {
  if (client) return client;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    if (!warnedMissing) {
      console.warn("[supabase] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set — logging disabled.");
      warnedMissing = true;
    }
    return null;
  }

  client = createClient(url, key);
  return client;
}

export interface RequestLogEntry {
  prompt: string;
  negative_prompt?: string | null;
  width: number;
  height: number;
  steps: number;
  n: number;
  size_requested: string;
  runware_task_uuid?: string | null;
  runware_cost_usd?: number | null;
  image_count?: number | null;
  status: "success" | "error";
  error_message?: string | null;
  latency_ms: number;
  consumer_ip?: string | null;
}

/**
 * Insert a request log entry into Supabase.
 * This is intentionally fire-and-forget — errors are logged but
 * do not propagate to the API response.
 */
export async function logRequest(entry: RequestLogEntry): Promise<void> {
  try {
    const db = getClient();
    if (!db) return;

    const { error } = await db.from("request_logs").insert(entry);
    if (error) {
      console.error("[supabase] Failed to insert log:", error.message);
    }
  } catch (err) {
    console.error("[supabase] Unexpected logging error:", err);
  }
}

/**
 * Simple health check: attempt a lightweight query to verify connectivity.
 */
export async function checkHealth(): Promise<boolean> {
  try {
    const db = getClient();
    if (!db) return false;

    const { error } = await db.from("request_logs").select("id").limit(1);
    return !error;
  } catch {
    return false;
  }
}
