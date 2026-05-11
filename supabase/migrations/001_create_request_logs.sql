-- Request logs for tracking usage, costs, and debugging.
-- Run this SQL in your Supabase SQL Editor to create the table.

CREATE TABLE IF NOT EXISTS request_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Request info
  prompt TEXT NOT NULL,
  negative_prompt TEXT,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  steps INTEGER NOT NULL DEFAULT 4,
  n INTEGER NOT NULL DEFAULT 1,
  size_requested TEXT,

  -- Runware response
  runware_task_uuid TEXT,
  runware_cost_usd DECIMAL(10, 6),
  image_count INTEGER,

  -- Status
  status TEXT NOT NULL DEFAULT 'pending',
  error_message TEXT,
  latency_ms INTEGER,

  -- Metadata
  consumer_ip TEXT
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_request_logs_created_at ON request_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_request_logs_status ON request_logs (status);
