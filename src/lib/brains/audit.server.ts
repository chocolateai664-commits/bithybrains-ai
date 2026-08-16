import { toCsv } from "./csv";
import type { Db } from "./db.server";

/**
 * Audit/telemetry querying shared by the console list view and the CSV export.
 * Visibility is enforced by RLS on the caller's client: admins see every row,
 * everyone else only their own. There is no service-role path here.
 */

export interface AuditFilters {
  search?: string | undefined;
  requestId?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  limit: number;
}

export async function queryAuditEvents(db: Db, userId: string, filters: AuditFilters) {
  const withFilters = <
    T extends { gte: (c: string, v: string) => T; lte: (c: string, v: string) => T; eq: (c: string, v: string) => T },
  >(
    q: T,
  ): T => {
    let out = q;
    if (filters.from) out = out.gte("created_at", filters.from);
    if (filters.to) out = out.lte("created_at", filters.to);
    if (filters.requestId) out = out.eq("request_id", filters.requestId);
    return out;
  };

  let auditQuery = withFilters(
    db
      .from("audit_logs")
      .select("id, user_id, action, resource, request_id, metadata, created_at")
      .order("created_at", { ascending: false })
      .limit(filters.limit),
  );
  if (filters.search) auditQuery = auditQuery.ilike("action", `%${filters.search}%`);

  let toolQuery = withFilters(
    db
      .from("tool_executions")
      .select("id, tool_slug, success, duration_ms, application, request_id, error, created_at")
      .order("created_at", { ascending: false })
      .limit(filters.limit),
  );
  if (filters.search) toolQuery = toolQuery.ilike("tool_slug", `%${filters.search}%`);

  let requestQuery = withFilters(
    db
      .from("ai_requests")
      .select("id, model_id, provider, intent, success, error, tools_used, request_id, created_at")
      .order("created_at", { ascending: false })
      .limit(filters.limit),
  );
  if (filters.search) requestQuery = requestQuery.ilike("model_id", `%${filters.search}%`);

  const [audit, tools, requests, admin] = await Promise.all([
    auditQuery,
    toolQuery,
    requestQuery,
    db.from("user_roles").select("role").eq("user_id", userId).eq("role", "admin").maybeSingle(),
  ]);

  if (audit.error) throw new Error(audit.error.message);

  return {
    isAdmin: !!admin.data,
    scope: admin.data ? ("all" as const) : ("own" as const),
    auditLogs: audit.data ?? [],
    toolExecutions: tools.data ?? [],
    aiRequests: requests.data ?? [],
  };
}

const CSV_COLUMNS = ["kind", "created_at", "request_id", "name", "detail", "extra"];

/** Flattens the three telemetry streams into one correlated, escaped CSV. */
export function auditCsv(events: Awaited<ReturnType<typeof queryAuditEvents>>): string {
  const rows = [
    ...events.auditLogs.map((r) => ({
      kind: "audit",
      created_at: r.created_at,
      request_id: r.request_id,
      name: r.action,
      detail: r.resource,
      extra: r.metadata,
    })),
    ...events.toolExecutions.map((r) => ({
      kind: "tool",
      created_at: r.created_at,
      request_id: r.request_id,
      name: r.tool_slug,
      detail: r.success ? "ok" : r.error,
      extra: { duration_ms: r.duration_ms, application: r.application },
    })),
    ...events.aiRequests.map((r) => ({
      kind: "model",
      created_at: r.created_at,
      request_id: r.request_id,
      name: r.model_id,
      detail: r.success ? "ok" : r.error,
      extra: { intent: r.intent, provider: r.provider, tools_used: r.tools_used },
    })),
  ].sort((a, b) => b.created_at.localeCompare(a.created_at));

  return toCsv(rows, CSV_COLUMNS);
}
