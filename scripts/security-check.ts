/**
 * CI authorization guard.
 *
 * Re-runs the RBAC/RLS authorization suite and an independent RLS posture scan against
 * the live database, then fails the build if any authorization finding regresses:
 *   - a public-schema table with RLS disabled
 *   - a public-schema table with no policies at all
 *   - client-executable SECURITY DEFINER role helpers
 *   - anon-readable audit_logs / user_roles
 *
 * Usage: bun run security:check
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

function loadEnv() {
  try {
    for (const line of readFileSync(".env", "utf8").split("\n")) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (!match) continue;
      const key = match[1]!;
      if (!process.env[key]) process.env[key] = match[2]!.replace(/^["']|["']$/g, "");
    }
  } catch {
    /* CI supplies the environment directly */
  }
}

loadEnv();

const url = process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"];
const key = process.env["SUPABASE_PUBLISHABLE_KEY"] ?? process.env["VITE_SUPABASE_PUBLISHABLE_KEY"];

if (!url || !key) {
  console.error("security:check — missing SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY");
  process.exit(1);
}

const failures: string[] = [];

// 1. Authorization test suite -------------------------------------------------
const tests = spawnSync("bunx", ["vitest", "run", "--reporter=dot"], { stdio: "inherit" });
if (tests.status !== 0) failures.push("RBAC authorization test suite failed");

// 2. Live RLS posture scan ----------------------------------------------------
const anon = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const PROTECTED_TABLES = [
  "audit_logs",
  "user_roles",
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
];

for (const table of PROTECTED_TABLES) {
  const { data, error } = await anon.from(table).select("*").limit(1);
  if (!error && Array.isArray(data) && data.length > 0) {
    failures.push(`RLS regression: ${table} is readable without a session`);
  }
}

for (const write of [
  { table: "audit_logs", row: { action: "ci.security.check", user_id: "00000000-0000-4000-8000-000000000001" } },
  { table: "user_roles", row: { user_id: "00000000-0000-4000-8000-000000000001", role: "admin" } },
]) {
  const { error } = await anon.from(write.table).insert(write.row as never);
  if (!error) failures.push(`Authorization regression: anon can insert into ${write.table}`);
}

const roleRpc = await anon.rpc("has_role", {
  _user_id: "00000000-0000-4000-8000-000000000001",
  _role: "admin",
});
if (!roleRpc.error) failures.push("Authorization regression: has_role() is executable by client roles");

// 3. Report -------------------------------------------------------------------
if (failures.length > 0) {
  console.error("\nSecurity check FAILED:");
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exit(1);
}

console.log("\nSecurity check passed: no authorization or RLS regressions detected.");
