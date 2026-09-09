import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { CONTAINERTRACK } from "@/applications/containertrack/config";
import { ensureCredits } from "@/applications/containertrack/services/creditService.server";
import { listPricingPlans, initializePayment, paystackConfigured } from "@/applications/containertrack/services/paymentService.server";
import { getOwnReport, getPublicVerification, listReports } from "@/applications/containertrack/services/reportService.server";
import { developmentFixturesEnabled, providerConfig, searchConfigured } from "@/applications/containertrack/services/providers.server";
import { runTracking } from "@/applications/containertrack/services/trackingService.server";
import { enforceToolRateLimit } from "@/lib/brains/ratelimit.server";
import { validateContainerNumber } from "@/lib/iso6346";
import type { TrackingOutcome } from "@/applications/containertrack/types";

/** Typed RPC surface for the ContainerTrack application. */

export const getContainerTrackDashboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [credits, reports, plans, requests] = await Promise.all([
      ensureCredits(supabaseAdmin, userId),
      listReports(supabase, 20),
      listPricingPlans(supabase, CONTAINERTRACK.slug),
      supabase
        .from("tracking_requests")
        .select("id, container_number, status, started_at, completed_at, report_id, error_message")
        .order("created_at", { ascending: false })
        .limit(10),
    ]);

    return {
      application: {
        slug: CONTAINERTRACK.slug,
        name: CONTAINERTRACK.name,
        capabilities: CONTAINERTRACK.capabilities,
        tools: CONTAINERTRACK.tools,
      },
      credits,
      reports,
      plans,
      requests: requests.data ?? [],
      status: {
        providerConfigured: !!providerConfig(),
        searchConfigured: searchConfigured(),
        paymentsConfigured: paystackConfigured(),
        developmentFixtures: developmentFixturesEnabled(),
        cacheTtlMinutes: CONTAINERTRACK.cache.ttlMinutes,
      },
    };
  });

export const trackContainer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ containerNumber: z.string().min(4).max(30) }).parse(data))
  .handler(async ({ context, data }): Promise<TrackingOutcome> => {
    const { supabase, userId } = context;

    const budget = await enforceToolRateLimit(userId);
    if (!budget.allowed) {
      return {
        ok: false,
        code: "RATE_LIMITED",
        message: "Too many tracking requests. Please wait a moment and try again.",
        requestId: crypto.randomUUID(),
        creditConsumed: false,
        cached: false,
        developmentData: false,
      };
    }

    const iso = validateContainerNumber(data.containerNumber);
    if (!iso.valid) {
      return {
        ok: false,
        code: "INVALID_CONTAINER",
        message: iso.message ?? "Invalid container number",
        requestId: crypto.randomUUID(),
        creditConsumed: false,
        cached: false,
        developmentData: false,
      };
    }

    return runTracking({ db: supabase, userId, containerNumber: iso.normalized });
  });

export const getTrackingReport = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ reportId: z.string().min(4).max(40) }).parse(data))
  .handler(async ({ context, data }) => getOwnReport(context.supabase, data.reportId));

/** Public: exposes only non-sensitive verification fields. */
export const verifyReport = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => z.object({ reportId: z.string().min(4).max(40) }).parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return getPublicVerification(supabaseAdmin, data.reportId);
  });

export const startCreditPurchase = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ planCode: z.string().min(1).max(40), returnUrl: z.string().url().max(300) }).parse(data),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId, claims } = context;

    if (!paystackConfigured()) {
      return { ok: false as const, code: "PAYMENT_ERROR", message: "Payments are not configured yet." };
    }

    const budget = await enforceToolRateLimit(userId);
    if (!budget.allowed) {
      return { ok: false as const, code: "RATE_LIMITED", message: "Too many payment attempts. Please wait a moment." };
    }

    const plans = await listPricingPlans(supabase, CONTAINERTRACK.slug);
    const plan = plans.find((p) => p.code === data.planCode);
    if (!plan) return { ok: false as const, code: "PAYMENT_ERROR", message: "Unknown pricing plan." };

    const email = (claims as { email?: string } | null)?.email;
    if (!email) return { ok: false as const, code: "PAYMENT_ERROR", message: "No email on the account." };

    try {
      const payment = await initializePayment({ userId, email, plan, callbackUrl: data.returnUrl });
      return { ok: true as const, authorizationUrl: payment.authorizationUrl, reference: payment.reference };
    } catch {
      return { ok: false as const, code: "PAYMENT_ERROR", message: "Payment could not be started." };
    }
  });
