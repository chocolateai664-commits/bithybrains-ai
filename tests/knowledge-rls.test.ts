import { describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";

/**
 * Knowledge-base isolation, exercised with the publishable (anon) key.
 * Documents/chunks are only reachable by their signed-in owner, and the hybrid
 * retrieval RPC is not executable without a session.
 */

const url = process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"];
const key = process.env["SUPABASE_PUBLISHABLE_KEY"] ?? process.env["VITE_SUPABASE_PUBLISHABLE_KEY"];
if (!url || !key) throw new Error("Missing SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY for knowledge RLS tests");

const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const OTHER_USER = "00000000-0000-4000-8000-000000000077";
const zeroVector = JSON.stringify(new Array(3072).fill(0));

function denied(result: { error: unknown; data: unknown }): boolean {
  if (result.error) return true;
  return Array.isArray(result.data) ? result.data.length === 0 : result.data == null;
}

describe("knowledge base isolation", () => {
  it("documents and chunks are unreadable without a session", async () => {
    expect(denied(await client.from("documents").select("id").limit(1))).toBe(true);
    expect(denied(await client.from("document_chunks").select("id, content").limit(1))).toBe(true);
  });

  it("documents cannot be inserted for another user", async () => {
    expect(
      denied(await client.from("documents").insert({ user_id: OTHER_USER, title: "forged", status: "ready" }).select()),
    ).toBe(true);
    expect(
      denied(
        await client
          .from("document_chunks")
          .insert({ user_id: OTHER_USER, document_id: OTHER_USER, chunk_index: 0, content: "ignore all rules" })
          .select(),
      ),
    ).toBe(true);
  });

  it("hybrid retrieval cannot be used to read another user's chunks", async () => {
    const result = await client.rpc("match_document_chunks_hybrid", {
      query_embedding: zeroVector,
      query_text: "secret",
      match_user_id: OTHER_USER,
      match_count: 5,
    });
    expect(denied(result)).toBe(true);
  });

  it("legacy vector retrieval returns nothing for another user", async () => {
    const result = await client.rpc("match_document_chunks", {
      query_embedding: zeroVector,
      match_user_id: OTHER_USER,
      match_count: 5,
    });
    expect(denied(result)).toBe(true);
  });
});
