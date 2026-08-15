import { RATE_LIMITS } from "./config.server";

/**
 * Distributed rate limiting.
 *
 * Counters live in Postgres (`consume_rate_limit`, service-role only), so limits
 * hold across every worker instance. The in-process map is only a degraded
 * fallback used when the database is unreachable — it fails closed on repeated
 * bursts rather than silently allowing unlimited traffic.
 */

export interface RateDecision {
  allowed: boolean;
  retryAfterSeconds: number;
  scope: string;
}

const localBuckets = new Map<string, { count: number; resetAt: number }>();

function localConsume(key: string, limit: number, windowSeconds: number): boolean {
  const now = Date.now();
  const bucket = localBuckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    localBuckets.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
    return true;
  }
  if (bucket.count >= limit) return false;
  bucket.count += 1;
  return true;
}

async function consume(key: string, limit: number, windowSeconds: number): Promise<boolean> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.rpc("consume_rate_limit", {
      _bucket_key: key,
      _limit: limit,
      _window_seconds: windowSeconds,
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (row && typeof row.allowed === "boolean") return row.allowed;
    throw new Error("rate limiter returned no decision");
  } catch {
    // Degraded mode: keep enforcing per-worker so an outage is not a bypass.
    return localConsume(key, limit, windowSeconds);
  }
}

export interface RateSubject {
  userId?: string | undefined;
  application?: string | undefined;
  ip?: string | undefined;
}

/** Enforces the chat policy across user, application and IP dimensions. */
export async function enforceChatRateLimit(subject: RateSubject): Promise<RateDecision> {
  const checks: Array<{ scope: string; key: string; limit: number; windowSeconds: number }> = [];
  if (subject.userId) {
    checks.push({ scope: "user", key: `chat:user:${subject.userId}`, ...RATE_LIMITS.chatUser });
  }
  if (subject.application) {
    checks.push({ scope: "application", key: `chat:app:${subject.application}`, ...RATE_LIMITS.chatApplication });
  }
  if (subject.ip) {
    checks.push({ scope: "ip", key: `chat:ip:${subject.ip}`, ...RATE_LIMITS.chatIp });
  }

  for (const check of checks) {
    const ok = await consume(check.key, check.limit, check.windowSeconds);
    if (!ok) return { allowed: false, retryAfterSeconds: check.windowSeconds, scope: check.scope };
  }
  return { allowed: true, retryAfterSeconds: 0, scope: "none" };
}

/** Throttles tool execution independently of the chat turn budget. */
export async function enforceToolRateLimit(userId: string): Promise<RateDecision> {
  const ok = await consume(`tool:user:${userId}`, RATE_LIMITS.toolUser.limit, RATE_LIMITS.toolUser.windowSeconds);
  return { allowed: ok, retryAfterSeconds: ok ? 0 : RATE_LIMITS.toolUser.windowSeconds, scope: "tool" };
}

/** Extracts a client IP from standard proxy headers. */
export function clientIp(request: Request): string | undefined {
  const header =
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-real-ip") ??
    request.headers.get("x-forwarded-for");
  if (!header) return undefined;
  return header.split(",")[0]?.trim() || undefined;
}
