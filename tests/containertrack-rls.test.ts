import { describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";

/**
 * ContainerTrack RLS posture, exercised with the publishable (anon) key —
 * exactly the privileges a browser client has.
 *
 * Credits, reports, tracking requests and payments must be system-written:
 * a client can never insert, update or delete them, and can never read
 * another user's rows.
 */

const url = process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"];
const key = process.env["SUPABASE_PUBLISHABLE_KEY"] ?? process.env["VITE_SUPABASE_PUBLISHABLE_KEY"];
if (!url || !key) throw new Error("Missing SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY for ContainerTrack RLS tests");

const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const RANDOM_UUID = "00000000-0000-4000-8000-000000000042";

function denied(result: { error: unknown; data: unknown }): boolean {
  if (result.error) return true;
  return Array.isArray(result.data) ? result.data.length === 0 : result.data == null;
}

describe("ContainerTrack tables are not client-writable", () => {
  it("usage_credits cannot be inserted or topped up from the client", async () => {
    expect(denied(await client.from("usage_credits").insert({ user_id: RANDOM_UUID, paid_credits: 999 }).select())).toBe(true);
    expect(denied(await client.from("usage_credits").update({ paid_credits: 999 }).eq("user_id", RANDOM_UUID).select())).toBe(true);
    expect(denied(await client.from("usage_credits").delete().eq("user_id", RANDOM_UUID).select())).toBe(true);
  });

  it("container_reports cannot be forged or altered from the client", async () => {
    expect(
      denied(
        await client
          .from("container_reports")
          .insert({ report_id: "CTR-2026-FORGED", user_id: RANDOM_UUID, container_number: "MSCU1234565", status: "DELIVERED", verified: true })
          .select(),
      ),
    ).toBe(true);
    expect(denied(await client.from("container_reports").update({ verified: true }).eq("report_id", "CTR-2026-FORGED").select())).toBe(true);
    expect(denied(await client.from("container_reports").delete().eq("report_id", "CTR-2026-FORGED").select())).toBe(true);
  });

  it("payments cannot be created or marked successful from the client", async () => {
    expect(
      denied(
        await client
          .from("payments")
          .insert({ user_id: RANDOM_UUID, reference: "FAKE-REF", credits_purchased: 100, status: "success" })
          .select(),
      ),
    ).toBe(true);
    expect(denied(await client.from("payments").update({ status: "success" }).eq("reference", "FAKE-REF").select())).toBe(true);
  });

  it("tracking_requests are read-only telemetry for clients", async () => {
    expect(denied(await client.from("tracking_requests").insert({ user_id: RANDOM_UUID, container_number: "MSCU1234565" }).select())).toBe(true);
    expect(denied(await client.from("tracking_requests").update({ status: "completed" }).eq("user_id", RANDOM_UUID).select())).toBe(true);
  });

  it("no rows of another user are readable without a session", async () => {
    for (const table of ["usage_credits", "container_reports", "tracking_requests", "payments", "tracking_cache"] as const) {
      expect(denied(await client.from(table).select("*").limit(1))).toBe(true);
    }
  });

  it("credit and payment routines are not callable by client roles", async () => {
    expect(!!(await client.rpc("consume_tracking_credit", { _user_id: RANDOM_UUID })).error).toBe(true);
    expect(!!(await client.rpc("ensure_user_credits", { _user_id: RANDOM_UUID })).error).toBe(true);
    expect(
      !!(
        await client.rpc("apply_payment_credits", {
          _provider: "paystack",
          _reference: "FAKE",
          _user_id: RANDOM_UUID,
          _credits: 100,
          _amount: 0,
          _currency: "NGN",
          _plan_code: null,
        })
      ).error,
    ).toBe(true);
  });
});
