/**
 * Centralized security configuration for Bithy Brains.
 *
 * Everything operational (CORS allowlist, rate limits, outbound-request limits)
 * lives here so policy is auditable in one place instead of scattered across
 * route handlers and tools.
 */

function list(name: string): string[] {
  return (process.env[name] ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

const DEV_ORIGINS = [
  "http://localhost:8080",
  "http://localhost:3000",
  "http://127.0.0.1:8080",
  "http://127.0.0.1:3000",
];

/** Origins allowed to call the public Brain API. */
export function allowedOrigins(): string[] {
  const configured = [
    ...list("BITHY_ALLOWED_ORIGINS"),
    ...list("BITHY_APP_ORIGINS"),
    process.env["BITHY_PUBLIC_ORIGIN"] ?? "",
  ].filter(Boolean);

  const isProduction = process.env["NODE_ENV"] === "production";
  return Array.from(new Set(isProduction ? configured : [...configured, ...DEV_ORIGINS]));
}

/**
 * Resolves CORS headers for a request. Unknown origins get no
 * `Access-Control-Allow-Origin` header at all, so browsers block the response
 * while non-browser clients with a valid bearer token keep working.
 */
export function corsHeaders(request: Request): Record<string, string> {
  const base: Record<string, string> = {
    Vary: "Origin",
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "600",
  };
  const origin = request.headers.get("origin");
  if (origin && allowedOrigins().includes(origin)) {
    base["Access-Control-Allow-Origin"] = origin;
  }
  return base;
}

export function isOriginAllowed(origin: string | null): boolean {
  if (!origin) return true; // non-browser clients send no Origin header
  return allowedOrigins().includes(origin);
}

/** Rate-limit policy, per subject kind. */
export const RATE_LIMITS = {
  /** Chat turns per authenticated user. */
  chatUser: { limit: 60, windowSeconds: 60 },
  /** Chat turns per calling application / API consumer. */
  chatApplication: { limit: 240, windowSeconds: 60 },
  /** Unauthenticated pressure per source IP (auth-sensitive path). */
  chatIp: { limit: 120, windowSeconds: 60 },
  /** Expensive tool executions per user. */
  toolUser: { limit: 120, windowSeconds: 60 },
} as const;

/** Outbound (connector) request limits. */
export const OUTBOUND = {
  timeoutMs: 8_000,
  maxRedirects: 2,
  maxBytes: 256 * 1024,
} as const;

/** Bounds applied to anything that reaches a model prompt. */
export const CONTEXT_LIMITS = {
  maxMessageChars: 8_000,
  maxContextBlockChars: 12_000,
  maxDocumentExcerptChars: 800,
  maxToolSummaryChars: 4_000,
  maxClientContextChars: 1_000,
  maxRequestBodyBytes: 128 * 1024,
} as const;
