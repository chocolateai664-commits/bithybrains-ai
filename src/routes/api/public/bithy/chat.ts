import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { authenticateRequest } from "@/lib/brains/auth.server";
import { CONTEXT_LIMITS, corsHeaders, isOriginAllowed } from "@/lib/brains/config.server";
import { clientIp, enforceChatRateLimit } from "@/lib/brains/ratelimit.server";
import { runBrain } from "@/lib/brains/orchestrator.server";

/**
 * POST /api/public/bithy/chat — the Bithy Brains API.
 * Bithy (web, mobile, desktop) and other applications consume this endpoint.
 *
 * Security: bearer authentication, origin allowlist, bounded body, distributed
 * rate limiting, and errors that carry a correlation ID but never internals.
 */

const BodySchema = z.object({
  message: z.string().trim().min(1).max(CONTEXT_LIMITS.maxMessageChars),
  conversationId: z.string().uuid().optional(),
  application: z.string().trim().max(64).optional(),
  page: z.string().trim().max(256).optional(),
  context: z.record(z.unknown()).optional(),
});

function json(request: Request, body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders(request), ...extra },
  });
}

export const Route = createFileRoute("/api/public/bithy/chat")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => new Response(null, { status: 204, headers: corsHeaders(request) }),
      POST: async ({ request }) => {
        const requestId = crypto.randomUUID();

        if (!isOriginAllowed(request.headers.get("origin"))) {
          return json(request, { error: "Origin not allowed", requestId }, 403);
        }

        const declaredLength = Number(request.headers.get("content-length") ?? "0");
        if (declaredLength > CONTEXT_LIMITS.maxRequestBodyBytes) {
          return json(request, { error: "Request body too large", requestId }, 413);
        }

        let auth;
        try {
          auth = await authenticateRequest(request);
        } catch {
          return json(request, { error: "Service unavailable", requestId }, 503);
        }
        if (!auth) return json(request, { error: "Unauthorized", requestId }, 401);

        let raw: string;
        try {
          raw = await request.text();
        } catch {
          return json(request, { error: "Invalid request body", requestId }, 400);
        }
        if (raw.length > CONTEXT_LIMITS.maxRequestBodyBytes) {
          return json(request, { error: "Request body too large", requestId }, 413);
        }

        let payload: unknown;
        try {
          payload = JSON.parse(raw);
        } catch {
          return json(request, { error: "Invalid JSON body", requestId }, 400);
        }

        const parsed = BodySchema.safeParse(payload);
        if (!parsed.success) {
          return json(request, { error: "Invalid request", requestId, details: parsed.error.flatten().fieldErrors }, 400);
        }

        const limit = await enforceChatRateLimit({
          userId: auth.userId,
          application: parsed.data.application,
          ip: clientIp(request),
        });
        if (!limit.allowed) {
          return json(
            request,
            { error: "Rate limit exceeded", scope: limit.scope, requestId },
            429,
            { "retry-after": String(limit.retryAfterSeconds) },
          );
        }

        try {
          const response = await runBrain(auth.db, auth.userId, parsed.data);
          return json(request, response);
        } catch (error) {
          // Detail stays in the server log; the client gets a correlation ID only.
          console.error("bithy_brains_chat_failed", {
            requestId,
            userId: auth.userId,
            message: error instanceof Error ? error.message : "unknown error",
          });
          return json(request, { error: "The brain could not complete this request.", requestId }, 500);
        }
      },
    },
  },
});
