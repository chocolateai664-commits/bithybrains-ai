import { createHmac, timingSafeEqual } from "crypto";
import type { Db } from "@/lib/brains/db.server";

/**
 * Payment layer (Paystack for the Nigerian MVP).
 *
 * Structured so another provider (Flutterwave) can be added by implementing
 * the same three operations. Credits are only ever granted from a verified
 * webhook + server-side transaction verification — never from the browser.
 */

const PAYSTACK_API = "https://api.paystack.co";

export interface PricingPlan {
  code: string;
  name: string;
  description: string | null;
  amount: number;
  currency: string;
  credits: number;
}

export async function listPricingPlans(db: Db, application: string): Promise<PricingPlan[]> {
  const { data } = await db
    .from("pricing_plans")
    .select("code, name, description, amount, currency, credits")
    .eq("application", application)
    .eq("status", "active")
    .order("sort_order");
  return (data ?? []).map((p) => ({ ...p, amount: Number(p.amount) }));
}

export function paystackConfigured(): boolean {
  return !!process.env["PAYSTACK_SECRET_KEY"];
}

export interface InitializedPayment {
  reference: string;
  authorizationUrl: string;
}

export async function initializePayment(input: {
  userId: string;
  email: string;
  plan: PricingPlan;
  callbackUrl: string;
}): Promise<InitializedPayment> {
  const secret = process.env["PAYSTACK_SECRET_KEY"];
  if (!secret) throw new Error("Payments are not configured");

  const reference = `CTP-${Date.now().toString(36).toUpperCase()}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const response = await fetch(`${PAYSTACK_API}/transaction/initialize`, {
    method: "POST",
    headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
    body: JSON.stringify({
      email: input.email,
      amount: Math.round(input.plan.amount * 100),
      currency: input.plan.currency,
      reference,
      callback_url: input.callbackUrl,
      metadata: { user_id: input.userId, plan_code: input.plan.code, credits: input.plan.credits },
    }),
  });

  if (!response.ok) throw new Error("Payment could not be started");
  const json = (await response.json()) as { data?: { authorization_url?: string; reference?: string } };
  const url = json.data?.authorization_url;
  if (!url) throw new Error("Payment could not be started");

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await supabaseAdmin.from("payments").insert({
    user_id: input.userId,
    provider: "paystack",
    reference,
    plan_code: input.plan.code,
    amount: input.plan.amount,
    currency: input.plan.currency,
    credits_purchased: input.plan.credits,
    status: "pending",
  });

  return { reference, authorizationUrl: url };
}

/** Constant-time verification of the Paystack webhook signature. */
export function verifyWebhookSignature(rawBody: string, signature: string | null): boolean {
  const secret = process.env["PAYSTACK_WEBHOOK_SECRET"] ?? process.env["PAYSTACK_SECRET_KEY"];
  if (!secret || !signature) return false;
  const expected = createHmac("sha512", secret).update(rawBody).digest("hex");
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Re-checks the transaction with Paystack; the webhook payload alone is not proof. */
export async function verifyTransaction(reference: string): Promise<{
  ok: boolean;
  amount: number;
  currency: string;
  userId?: string;
  planCode?: string;
  credits?: number;
}> {
  const secret = process.env["PAYSTACK_SECRET_KEY"];
  if (!secret) return { ok: false, amount: 0, currency: "NGN" };

  const response = await fetch(`${PAYSTACK_API}/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: { authorization: `Bearer ${secret}` },
  });
  if (!response.ok) return { ok: false, amount: 0, currency: "NGN" };

  const json = (await response.json()) as {
    data?: {
      status?: string;
      amount?: number;
      currency?: string;
      metadata?: { user_id?: string; plan_code?: string; credits?: number };
    };
  };
  const data = json.data;
  if (!data || data.status !== "success") return { ok: false, amount: 0, currency: "NGN" };

  const result: {
    ok: boolean;
    amount: number;
    currency: string;
    userId?: string;
    planCode?: string;
    credits?: number;
  } = {
    ok: true,
    amount: (data.amount ?? 0) / 100,
    currency: data.currency ?? "NGN",
  };
  if (data.metadata?.user_id) result.userId = data.metadata.user_id;
  if (data.metadata?.plan_code) result.planCode = data.metadata.plan_code;
  if (data.metadata?.credits !== undefined) result.credits = Number(data.metadata.credits);
  return result;
}

/** Idempotent credit grant. Safe to call twice for the same reference. */
export async function applyPaymentCredits(input: {
  reference: string;
  userId: string;
  credits: number;
  amount: number;
  currency: string;
  planCode: string | null;
}): Promise<{ applied: boolean; paidCredits: number }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.rpc("apply_payment_credits", {
    _provider: "paystack",
    _reference: input.reference,
    _user_id: input.userId,
    _credits: input.credits,
    _amount: input.amount,
    _currency: input.currency,
    _plan_code: input.planCode,
  });
  if (error) throw new Error(error.message);
  const row = (Array.isArray(data) ? data[0] : data) as { applied: boolean; paid_credits: number } | null;
  return { applied: !!row?.applied, paidCredits: row?.paid_credits ?? 0 };
}
