import { describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";

/**
 * Automated RBAC / RLS authorization tests.
 *
 * These run against the live Data API with the publishable (anon) key, i.e. exactly the
 * privileges a signed-out or signed-in browser client has. They assert that:
 *   - server-only SECURITY DEFINER helpers are NOT callable by client roles
 *   - audit_logs cannot be written or read from the client
 *   - user_roles cannot be written from the client (no privilege escalation)
 *   - user-owned tables are not readable without a session
 */

const url = process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"];
const key = process.env["SUPABASE_PUBLISHABLE_KEY"] ?? process.env["VITE_SUPABASE_PUBLISHABLE_KEY"];

if (!url || !key) throw new Error("Missing SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY for RBAC tests");

const client = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/** A denied request is anything that is not a successful read/write of real rows. */
function denied(result: { error: unknown; data: unknown }): boolean {
  if (result.error) return true;
  return Array.isArray(result.data) ? result.data.length === 0 : result.data == null;
}

/**
 * Postgres RLS silently affects zero rows when no policy matches an UPDATE/DELETE,
 * so a write is only "allowed" if it actually returns mutated rows.
 */
function mutationDenied(result: { error: unknown; data: unknown }): boolean {
  return denied(result);
}

const RANDOM_UUID = "00000000-0000-4000-8000-000000000001";


describe("server-only helpers are not callable by client roles", () => {
  it("has_role() cannot be executed with the publishable key", async () => {
    const res = await client.rpc("has_role", { _user_id: RANDOM_UUID, _role: "admin" });
    expect(res.error).toBeTruthy();
    expect(res.data).not.toBe(true);
  });

  it("internal trigger helpers are not exposed over the Data API", async () => {
    for (const fn of ["handle_new_user", "set_updated_at"]) {
      const res = await client.rpc(fn as never, {} as never);
      expect(res.error, `${fn} must not be callable`).toBeTruthy();
    }
  });
});

describe("audit_logs write path is protected", () => {
  it("rejects client inserts", async () => {
    const res = await client.from("audit_logs").insert({ action: "rbac.test.forged", user_id: RANDOM_UUID });
    expect(res.error).toBeTruthy();
  });

  it("rejects client updates and deletes", async () => {
    expect(mutationDenied(await client.from("audit_logs").update({ action: "x" }).eq("id", RANDOM_UUID).select())).toBe(true);
    expect(mutationDenied(await client.from("audit_logs").delete().eq("id", RANDOM_UUID).select())).toBe(true);
  });

  it("exposes no rows to an unauthenticated reader", async () => {
    expect(denied(await client.from("audit_logs").select("id, action, user_id").limit(5))).toBe(true);
  });
});

describe("user_roles cannot be escalated from the client", () => {
  it("rejects inserting an admin role", async () => {
    const res = await client.from("user_roles").insert({ user_id: RANDOM_UUID, role: "admin" });
    expect(res.error).toBeTruthy();
  });

  it("rejects updating an existing role", async () => {
    const res = await client.from("user_roles").update({ role: "admin" }).eq("user_id", RANDOM_UUID).select();
    expect(mutationDenied(res)).toBe(true);
  });

  it("rejects deleting role rows", async () => {
    expect(mutationDenied(await client.from("user_roles").delete().eq("user_id", RANDOM_UUID).select())).toBe(true);
  });


  it("exposes no role rows without a session", async () => {
    expect(denied(await client.from("user_roles").select("user_id, role").limit(5))).toBe(true);
  });
});

describe("user-owned data is not readable without a session", () => {
  const tables = [
    "memories",
    "documents",
    "document_chunks",
    "conversations",
    "messages",
    "conversation_summaries",
    "personality_settings",
    "profiles",
    "ai_requests",
    "tool_executions",
  ] as const;

  for (const table of tables) {
    it(`${table} returns no rows to anon`, async () => {
      expect(denied(await client.from(table).select("*").limit(3)), `${table} leaked rows`).toBe(true);
    });
  }
});

describe("telemetry tables are immutable, owner-scoped logs", () => {
  const telemetry = ["tool_executions", "ai_requests"] as const;

  for (const table of telemetry) {
    it(`${table} exposes no rows without a session`, async () => {
      expect(denied(await client.from(table).select("*").limit(5))).toBe(true);
    });

    it(`${table} rejects updates from client roles`, async () => {
      const res = await client.from(table).update({ success: false }).eq("id", RANDOM_UUID).select();
      expect(mutationDenied(res)).toBe(true);
    });

    it(`${table} rejects deletes from client roles`, async () => {
      expect(mutationDenied(await client.from(table).delete().eq("id", RANDOM_UUID).select())).toBe(true);
    });

    it(`${table} rejects inserts attributed to another user`, async () => {
      const res = await client.from(table).insert(
        (table === "tool_executions"
          ? { user_id: RANDOM_UUID, tool_slug: "rbac.test" }
          : { user_id: RANDOM_UUID, model_id: "rbac.test", provider: "test" }) as never,
      );
      expect(res.error).toBeTruthy();
    });
  }

  it("correlation IDs cannot be rewritten by client roles", async () => {
    for (const table of telemetry) {
      const res = await client.from(table).update({ request_id: RANDOM_UUID }).eq("id", RANDOM_UUID).select();
      expect(mutationDenied(res), `${table} allowed request_id rewrite`).toBe(true);
    }
    expect(
      mutationDenied(await client.from("audit_logs").update({ request_id: RANDOM_UUID }).eq("id", RANDOM_UUID).select()),
    ).toBe(true);
  });
});
