import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { authenticateRequest, rateLimit } from "@/lib/brains/auth.server";
import { runBrain } from "@/lib/brains/orchestrator.server";

/**
 * POST /api/public/bithy/chat — the Bithy Brains API.
 * Bithy (web, mobile, desktop) and other applications consume this endpoint.
 */

const BodySchema = z.object({
  message: z.string().trim().min(1).max(8000),
  conversationId: z.string().uuid().optional(),
  application: z.string().trim().max(64).optional(),
  page: z.string().trim().max(256).optional(),
  context: z.record(z.unknown()).optional(),
});

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...CORS },
  });
}

export const Route = createFileRoute("/api/public/bithy/chat")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request }) => {
        let auth;
        try {
          auth = await authenticateRequest(request);
        } catch {
          return json({ error: "Service unavailable" }, 503);
        }
        if (!auth) return json({ error: "Unauthorized" }, 401);

        if (!rateLimit(auth.userId)) return json({ error: "Rate limit exceeded" }, 429);

        let payload: unknown;
        try {
          payload = await request.json();
        } catch {
          return json({ error: "Invalid JSON body" }, 400);
        }

        const parsed = BodySchema.safeParse(payload);
        if (!parsed.success) {
          return json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors }, 400);
        }

        try {
          const response = await runBrain(auth.db, auth.userId, parsed.data);
          return json(response);
        } catch (error) {
          console.error("bithy_brains_chat_failed", error instanceof Error ? error.message : error);
          return json({ error: "The brain could not complete this request." }, 500);
        }
      },
    },
  },
});
