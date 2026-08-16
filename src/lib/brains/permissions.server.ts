import type { Db } from "./db.server";

/**
 * Permission layer: User -> Application -> Tool -> Permission -> Action.
 * Tools never execute without passing through `authorizeTool`, and every check
 * runs server-side against the database registry — never against UI state.
 */

export type PermissionKind = "read" | "write" | "admin";

export interface PermissionDecision {
  allowed: boolean;
  requiresConfirmation: boolean;
  reason?: string;
}

export function kindOf(permission: string): PermissionKind {
  if (permission.endsWith(":admin")) return "admin";
  if (permission.endsWith(":write")) return "write";
  return "read";
}

/** Tools that only make sense in the context of a connected application. */
export const APP_SCOPED_TOOLS = [
  "getApplicationData",
  "getDashboardStats",
  "createTask",
  "updateTask",
  "analyzeData",
];

export interface AuthorizeInput {
  userId: string;
  isAdmin: boolean;
  application?: string | undefined;
  toolSlug: string;
  toolPermissions: string[];
  destructive: boolean;
  confirmed: boolean;
}

export async function authorizeTool(db: Db, input: AuthorizeInput): Promise<PermissionDecision> {
  if (!input.userId) {
    return { allowed: false, requiresConfirmation: false, reason: "Authentication required" };
  }

  // 1. Registry check — the database is the source of truth for tool state,
  //    permissions and destructiveness, not the in-code registry alone.
  const { data: registered } = await db
    .from("tools")
    .select("slug, status, permissions, destructive")
    .eq("slug", input.toolSlug)
    .maybeSingle();

  if (registered && registered.status !== "active") {
    return { allowed: false, requiresConfirmation: false, reason: "Tool is disabled" };
  }

  const permissions = Array.from(new Set([...(registered?.permissions ?? []), ...input.toolPermissions]));
  const destructive = registered?.destructive || input.destructive;
  const kinds = permissions.map(kindOf);

  // 2. Permission/action check.
  if (kinds.includes("admin") && !input.isAdmin) {
    return { allowed: false, requiresConfirmation: false, reason: "Administrative permission required" };
  }

  // 3. Application scope check.
  if (input.application) {
    const { data: app } = await db
      .from("applications")
      .select("slug, status, tools")
      .eq("slug", input.application)
      .maybeSingle();

    if (!app || app.status !== "active") {
      return { allowed: false, requiresConfirmation: false, reason: "Application is not connected or inactive" };
    }
    if (APP_SCOPED_TOOLS.includes(input.toolSlug) && !app.tools.includes(input.toolSlug)) {
      return { allowed: false, requiresConfirmation: false, reason: "Tool is not enabled for this application" };
    }
    // A write/admin action must be explicitly granted by the application entry.
    if (kinds.some((k) => k !== "read") && !app.tools.includes(input.toolSlug)) {
      return { allowed: false, requiresConfirmation: false, reason: "Write action is not granted to this application" };
    }
  } else if (APP_SCOPED_TOOLS.includes(input.toolSlug)) {
    return { allowed: false, requiresConfirmation: false, reason: "No application context supplied" };
  }

  // 4. Destructive actions require explicit confirmation.
  if (destructive && !input.confirmed) {
    return { allowed: false, requiresConfirmation: true, reason: "Explicit confirmation required" };
  }

  return { allowed: true, requiresConfirmation: false };
}

export async function isAdmin(db: Db, userId: string): Promise<boolean> {
  // Role checks read the role table directly under RLS (users may read only their own roles).
  const { data } = await db
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  return !!data;
}

export async function auditLog(
  db: Db,
  entry: { userId: string; action: string; resource?: string; requestId?: string; metadata?: Record<string, unknown> },
): Promise<void> {
  // Audit rows are written with the service client; failures must never break a request.
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("audit_logs").insert({
      user_id: entry.userId,
      action: entry.action,
      resource: entry.resource ?? null,
      request_id: entry.requestId ?? null,
      metadata: (entry.metadata ?? {}) as never,
    });
  } catch {
    /* observability must not affect the user-facing path */
  }
}
