import type { Db } from "./db.server";

/**
 * Permission layer: User -> Application -> Tool -> Permission -> Action.
 * Tools never execute without passing through `authorizeTool`.
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
  const kinds = input.toolPermissions.map(kindOf);

  if (kinds.includes("admin") && !input.isAdmin) {
    return { allowed: false, requiresConfirmation: false, reason: "Administrative permission required" };
  }

  if (input.application) {
    const { data: app } = await db
      .from("applications")
      .select("slug, status, tools")
      .eq("slug", input.application)
      .maybeSingle();

    if (!app || app.status !== "active") {
      return { allowed: false, requiresConfirmation: false, reason: "Application is not connected or inactive" };
    }
    const appScoped = ["getApplicationData", "getDashboardStats", "createTask", "updateTask", "analyzeData"];
    if (appScoped.includes(input.toolSlug) && !app.tools.includes(input.toolSlug)) {
      return { allowed: false, requiresConfirmation: false, reason: "Tool is not enabled for this application" };
    }
  } else if (["getApplicationData", "getDashboardStats", "createTask", "updateTask"].includes(input.toolSlug)) {
    return { allowed: false, requiresConfirmation: false, reason: "No application context supplied" };
  }

  if (input.destructive && !input.confirmed) {
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
  entry: { userId: string; action: string; resource?: string; metadata?: Record<string, unknown> },
): Promise<void> {
  // Audit rows are written with the service client; failures must never break a request.
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("audit_logs").insert({
      user_id: entry.userId,
      action: entry.action,
      resource: entry.resource ?? null,
      metadata: (entry.metadata ?? {}) as never,
    });
  } catch {
    /* observability must not affect the user-facing path */
  }
}
