-- Create sync_logs table for tracking external-sync and external-csv-sync calls
CREATE TABLE IF NOT EXISTS sync_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  source TEXT NOT NULL CHECK (source IN ('external-sync', 'external-csv-sync')),
  status TEXT NOT NULL CHECK (status IN ('success', 'partial', 'failed')),
  application_name TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER,

  -- Request summary
  total_partners INTEGER DEFAULT 0,
  partners_created INTEGER DEFAULT 0,
  partners_updated INTEGER DEFAULT 0,
  partners_failed INTEGER DEFAULT 0,
  total_stove_ids INTEGER DEFAULT 0,
  stove_ids_created INTEGER DEFAULT 0,
  stove_ids_skipped INTEGER DEFAULT 0,

  -- Detailed log entries for each partner processed
  entries JSONB DEFAULT '[]'::jsonb,

  -- Full request/response snapshot (sanitized - no passwords in plain)
  request_summary JSONB,
  error_message TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast filtering
CREATE INDEX idx_sync_logs_source ON sync_logs(source);
CREATE INDEX idx_sync_logs_status ON sync_logs(status);
CREATE INDEX idx_sync_logs_started_at ON sync_logs(started_at DESC);
CREATE INDEX idx_sync_logs_application_name ON sync_logs(application_name);

-- RLS: only service role can insert, authenticated admins can read
ALTER TABLE sync_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON sync_logs
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Super admins can read sync_logs" ON sync_logs
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('super_admin', 'admin')
    )
  );
