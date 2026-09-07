-- ============ ContainerTrack schema ============

ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS application text;

-- ---------- usage_credits ----------
CREATE TABLE public.usage_credits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  free_credits integer NOT NULL DEFAULT 5,
  paid_credits integer NOT NULL DEFAULT 0,
  total_used integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.usage_credits TO authenticated;
GRANT ALL ON public.usage_credits TO service_role;
ALTER TABLE public.usage_credits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read own credits" ON public.usage_credits FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "credits are system managed (no insert)" ON public.usage_credits AS RESTRICTIVE FOR INSERT TO authenticated, anon WITH CHECK (false);
CREATE POLICY "credits are system managed (no update)" ON public.usage_credits AS RESTRICTIVE FOR UPDATE TO authenticated, anon USING (false);
CREATE POLICY "credits are system managed (no delete)" ON public.usage_credits AS RESTRICTIVE FOR DELETE TO authenticated, anon USING (false);
CREATE TRIGGER usage_credits_updated_at BEFORE UPDATE ON public.usage_credits FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------- container_reports ----------
CREATE TABLE public.container_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id text NOT NULL UNIQUE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  container_number text NOT NULL,
  carrier text,
  status text NOT NULL,
  current_location text,
  origin text,
  destination text,
  vessel text,
  voyage text,
  last_event text,
  last_event_date text,
  estimated_arrival text,
  tracking_source text,
  source_url text,
  source_timestamp timestamptz,
  confidence numeric NOT NULL DEFAULT 0,
  verified boolean NOT NULL DEFAULT false,
  request_id uuid,
  raw_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.container_reports TO authenticated;
GRANT ALL ON public.container_reports TO service_role;
ALTER TABLE public.container_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read own reports" ON public.container_reports FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "reports are system written (no insert)" ON public.container_reports AS RESTRICTIVE FOR INSERT TO authenticated, anon WITH CHECK (false);
CREATE POLICY "reports are immutable (no update)" ON public.container_reports AS RESTRICTIVE FOR UPDATE TO authenticated, anon USING (false);
CREATE POLICY "reports are immutable (no delete)" ON public.container_reports AS RESTRICTIVE FOR DELETE TO authenticated, anon USING (false);
CREATE INDEX container_reports_user_idx ON public.container_reports (user_id, created_at DESC);
CREATE INDEX container_reports_container_idx ON public.container_reports (container_number);

-- ---------- tracking_requests ----------
CREATE TABLE public.tracking_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  container_number text NOT NULL,
  status text NOT NULL DEFAULT 'started',
  request_id uuid,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  error_message text,
  report_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.tracking_requests TO authenticated;
GRANT ALL ON public.tracking_requests TO service_role;
ALTER TABLE public.tracking_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read own tracking requests" ON public.tracking_requests FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "tracking requests are system written (no insert)" ON public.tracking_requests AS RESTRICTIVE FOR INSERT TO authenticated, anon WITH CHECK (false);
CREATE POLICY "tracking requests are immutable (no update)" ON public.tracking_requests AS RESTRICTIVE FOR UPDATE TO authenticated, anon USING (false);
CREATE POLICY "tracking requests are immutable (no delete)" ON public.tracking_requests AS RESTRICTIVE FOR DELETE TO authenticated, anon USING (false);
CREATE INDEX tracking_requests_user_idx ON public.tracking_requests (user_id, created_at DESC);

-- ---------- payments ----------
CREATE TABLE public.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'paystack',
  reference text NOT NULL,
  plan_code text,
  amount numeric NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'NGN',
  credits_purchased integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, reference)
);
GRANT SELECT ON public.payments TO authenticated;
GRANT ALL ON public.payments TO service_role;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read own payments" ON public.payments FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "payments are system written (no insert)" ON public.payments AS RESTRICTIVE FOR INSERT TO authenticated, anon WITH CHECK (false);
CREATE POLICY "payments are system written (no update)" ON public.payments AS RESTRICTIVE FOR UPDATE TO authenticated, anon USING (false);
CREATE POLICY "payments are system written (no delete)" ON public.payments AS RESTRICTIVE FOR DELETE TO authenticated, anon USING (false);
CREATE TRIGGER payments_updated_at BEFORE UPDATE ON public.payments FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------- tracking_cache ----------
CREATE TABLE public.tracking_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  container_number text NOT NULL UNIQUE,
  payload jsonb NOT NULL,
  source_timestamp timestamptz,
  retrieved_at timestamptz NOT NULL DEFAULT now(),
  cached_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
GRANT ALL ON public.tracking_cache TO service_role;
ALTER TABLE public.tracking_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role manages tracking cache" ON public.tracking_cache FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ---------- pricing_plans ----------
CREATE TABLE public.pricing_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application text NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  description text,
  amount numeric NOT NULL,
  currency text NOT NULL DEFAULT 'NGN',
  credits integer NOT NULL,
  sort_order integer NOT NULL DEFAULT 100,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (application, code)
);
GRANT SELECT ON public.pricing_plans TO authenticated;
GRANT ALL ON public.pricing_plans TO service_role;
ALTER TABLE public.pricing_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read active pricing" ON public.pricing_plans FOR SELECT TO authenticated USING (status = 'active');
CREATE POLICY "admins manage pricing" ON public.pricing_plans FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = 'admin'::app_role))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = 'admin'::app_role));
CREATE TRIGGER pricing_plans_updated_at BEFORE UPDATE ON public.pricing_plans FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.pricing_plans (application, code, name, description, amount, currency, credits, sort_order) VALUES
  ('containertrack', 'single', 'Single Report', 'One container tracking report.', 1600, 'NGN', 1, 10),
  ('containertrack', 'detailed', 'Detailed Report', 'One detailed tracking report with extended sourcing.', 2000, 'NGN', 1, 20),
  ('containertrack', 'pack5', '5 Reports', 'Five tracking credits.', 7500, 'NGN', 5, 30),
  ('containertrack', 'pack10', '10 Reports', 'Ten tracking credits.', 14000, 'NGN', 10, 40),
  ('containertrack', 'pack25', '25 Reports', 'Twenty-five tracking credits.', 30000, 'NGN', 25, 50);

-- ---------- credit engine ----------
CREATE OR REPLACE FUNCTION public.ensure_user_credits(_user_id uuid)
RETURNS public.usage_credits
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE row public.usage_credits;
BEGIN
  INSERT INTO public.usage_credits (user_id) VALUES (_user_id)
  ON CONFLICT (user_id) DO NOTHING;
  SELECT * INTO row FROM public.usage_credits WHERE user_id = _user_id;
  RETURN row;
END;
$$;
REVOKE ALL ON FUNCTION public.ensure_user_credits(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_user_credits(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.consume_tracking_credit(_user_id uuid)
RETURNS TABLE(consumed boolean, free_credits integer, paid_credits integer, total_used integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE row public.usage_credits;
BEGIN
  INSERT INTO public.usage_credits (user_id) VALUES (_user_id) ON CONFLICT (user_id) DO NOTHING;
  SELECT * INTO row FROM public.usage_credits WHERE user_id = _user_id FOR UPDATE;

  IF row.free_credits > 0 THEN
    UPDATE public.usage_credits
      SET free_credits = free_credits - 1, total_used = total_used + 1
      WHERE user_id = _user_id
      RETURNING * INTO row;
    RETURN QUERY SELECT true, row.free_credits, row.paid_credits, row.total_used;
  ELSIF row.paid_credits > 0 THEN
    UPDATE public.usage_credits
      SET paid_credits = paid_credits - 1, total_used = total_used + 1
      WHERE user_id = _user_id
      RETURNING * INTO row;
    RETURN QUERY SELECT true, row.free_credits, row.paid_credits, row.total_used;
  ELSE
    RETURN QUERY SELECT false, row.free_credits, row.paid_credits, row.total_used;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.consume_tracking_credit(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_tracking_credit(uuid) TO service_role;

-- Credits added by a verified payment only. Idempotent on (provider, reference).
CREATE OR REPLACE FUNCTION public.apply_payment_credits(
  _provider text, _reference text, _user_id uuid, _credits integer, _amount numeric, _currency text, _plan_code text
)
RETURNS TABLE(applied boolean, paid_credits integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE existing public.payments;
DECLARE credits_row public.usage_credits;
BEGIN
  SELECT * INTO existing FROM public.payments
    WHERE provider = _provider AND reference = _reference FOR UPDATE;

  IF existing.id IS NOT NULL AND existing.status = 'success' THEN
    SELECT * INTO credits_row FROM public.usage_credits WHERE user_id = _user_id;
    RETURN QUERY SELECT false, COALESCE(credits_row.paid_credits, 0);
    RETURN;
  END IF;

  IF existing.id IS NULL THEN
    INSERT INTO public.payments (user_id, provider, reference, plan_code, amount, currency, credits_purchased, status)
    VALUES (_user_id, _provider, _reference, _plan_code, _amount, _currency, _credits, 'success');
  ELSE
    UPDATE public.payments
      SET status = 'success', credits_purchased = _credits, amount = _amount, currency = _currency, plan_code = _plan_code
      WHERE id = existing.id;
  END IF;

  INSERT INTO public.usage_credits (user_id) VALUES (_user_id) ON CONFLICT (user_id) DO NOTHING;
  UPDATE public.usage_credits
    SET paid_credits = paid_credits + _credits
    WHERE user_id = _user_id
    RETURNING * INTO credits_row;

  RETURN QUERY SELECT true, credits_row.paid_credits;
END;
$$;
REVOKE ALL ON FUNCTION public.apply_payment_credits(text, text, uuid, integer, numeric, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_payment_credits(text, text, uuid, integer, numeric, text, text) TO service_role;

-- ---------- application + tool registration ----------
INSERT INTO public.applications (slug, name, description, capabilities, tools, status)
VALUES (
  'containertrack',
  'ContainerTrack',
  'Container tracking, logistics verification and printable tracking reports.',
  ARRAY['container_tracking','container_validation','carrier_lookup','shipment_status','logistics_search','tracking_report_generation','report_verification'],
  ARRAY['validateContainerNumber','identifyCarrier','trackContainer','searchContainerWeb','getCarrierInformation','generateTrackingReport'],
  'active'
)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  capabilities = EXCLUDED.capabilities,
  tools = EXCLUDED.tools,
  status = 'active';

INSERT INTO public.tools (slug, name, description, parameters, permissions, destructive, status) VALUES
  ('validateContainerNumber', 'Validate Container Number', 'Deterministic ISO 6346 container number validation.', '{"container_number":"string"}', ARRAY['containertrack:read'], false, 'active'),
  ('identifyCarrier', 'Identify Carrier', 'Resolve the carrier from the container owner code.', '{"container_number":"string"}', ARRAY['containertrack:read'], false, 'active'),
  ('trackContainer', 'Track Container', 'Retrieve container status from the configured tracking provider.', '{"container_number":"string"}', ARRAY['containertrack:read'], false, 'active'),
  ('searchContainerWeb', 'Search Container Web Sources', 'Query approved public logistics sources for container status.', '{"container_number":"string"}', ARRAY['containertrack:read'], false, 'active'),
  ('getCarrierInformation', 'Get Carrier Information', 'Return carrier reference details for an identified carrier.', '{"carrier":"string"}', ARRAY['containertrack:read'], false, 'active'),
  ('generateTrackingReport', 'Generate Tracking Report', 'Persist a validated tracking result as a printable report.', '{"container_number":"string"}', ARRAY['containertrack:write'], false, 'active')
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  parameters = EXCLUDED.parameters,
  permissions = EXCLUDED.permissions,
  status = 'active';