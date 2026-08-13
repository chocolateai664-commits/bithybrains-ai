ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS request_id uuid;
ALTER TABLE public.ai_requests ADD COLUMN IF NOT EXISTS request_id uuid;
ALTER TABLE public.tool_executions ADD COLUMN IF NOT EXISTS request_id uuid;

CREATE INDEX IF NOT EXISTS audit_logs_request_id_idx ON public.audit_logs (request_id);
CREATE INDEX IF NOT EXISTS ai_requests_request_id_idx ON public.ai_requests (request_id);
CREATE INDEX IF NOT EXISTS tool_executions_request_id_idx ON public.tool_executions (request_id);
CREATE INDEX IF NOT EXISTS ai_requests_created_at_idx ON public.ai_requests (created_at DESC);
CREATE INDEX IF NOT EXISTS tool_executions_created_at_idx ON public.tool_executions (created_at DESC);

-- Immutable telemetry: explicitly deny UPDATE/DELETE for every client role.
REVOKE UPDATE, DELETE ON public.tool_executions FROM authenticated, anon;
REVOKE UPDATE, DELETE ON public.ai_requests FROM authenticated, anon;

DROP POLICY IF EXISTS "telemetry is immutable (no update)" ON public.tool_executions;
CREATE POLICY "telemetry is immutable (no update)"
  ON public.tool_executions AS RESTRICTIVE FOR UPDATE TO authenticated, anon USING (false);

DROP POLICY IF EXISTS "telemetry is immutable (no delete)" ON public.tool_executions;
CREATE POLICY "telemetry is immutable (no delete)"
  ON public.tool_executions AS RESTRICTIVE FOR DELETE TO authenticated, anon USING (false);

DROP POLICY IF EXISTS "telemetry is immutable (no update)" ON public.ai_requests;
CREATE POLICY "telemetry is immutable (no update)"
  ON public.ai_requests AS RESTRICTIVE FOR UPDATE TO authenticated, anon USING (false);

DROP POLICY IF EXISTS "telemetry is immutable (no delete)" ON public.ai_requests;
CREATE POLICY "telemetry is immutable (no delete)"
  ON public.ai_requests AS RESTRICTIVE FOR DELETE TO authenticated, anon USING (false);