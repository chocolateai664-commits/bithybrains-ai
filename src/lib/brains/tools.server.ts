import { CONTEXT_LIMITS } from "./config.server";
import type { Db } from "./db.server";
import { searchMemories } from "./memory.server";
import { OutboundUrlError, safeFetch } from "./net.server";
import { searchKnowledge } from "./rag.server";
import { authorizeTool, isAdmin } from "./permissions.server";
import { enforceToolRateLimit } from "./ratelimit.server";
import type { BithyTool, ToolContext, ToolResult } from "./types";


/**
 * Tool registry. Tools are declarative, permission-scoped and executed by the
 * orchestrator only — the AI model never runs arbitrary code.
 */

function makeRegistry(db: Db): Record<string, BithyTool> {
  const tools: BithyTool[] = [
    {
      id: "searchMemory",
      name: "Search Memory",
      description: "Semantic search over the user's long-term memories.",
      parameters: { query: "string" },
      permissions: ["memory:read"],
      destructive: false,
      execute: async (ctx: ToolContext) => {
        if (!ctx.queryEmbedding) return { ok: false, summary: "", error: "No query embedding available" };
        const memories = await searchMemories(db, ctx.userId, ctx.queryEmbedding, {
          limit: 5,
          application: ctx.application,
        });
        return {
          ok: true,
          summary: memories.map((m) => `- ${m.content}`).join("\n"),
          data: memories,
        };
      },
    },
    {
      id: "searchKnowledge",
      name: "Search Knowledge",
      description: "Semantic search over ingested documents.",
      parameters: { query: "string" },
      permissions: ["knowledge:read"],
      destructive: false,
      execute: async (ctx: ToolContext) => {
        if (!ctx.queryEmbedding) return { ok: false, summary: "", error: "No query embedding available" };
        const chunks = await searchKnowledge(db, ctx.userId, ctx.queryEmbedding, {
          limit: 5,
          application: ctx.application,
        });
        return {
          ok: true,
          summary: chunks.map((c) => `[${c.title}] ${c.content}`).join("\n\n"),
          data: chunks,
          sources: chunks.map((c) => ({ id: c.id, title: c.title, relevance: Number(c.similarity.toFixed(3)) })),
        };
      },
    },
    {
      id: "getDashboardStats",
      name: "Get Dashboard Stats",
      description: "Aggregate brain usage stats for the current user.",
      parameters: { application: "string" },
      permissions: ["application:read"],
      destructive: false,
      execute: async (ctx: ToolContext) => {
        const [{ count: memoryCount }, { count: docCount }, { count: convoCount }] = await Promise.all([
          db.from("memories").select("id", { count: "exact", head: true }).eq("user_id", ctx.userId),
          db.from("documents").select("id", { count: "exact", head: true }).eq("user_id", ctx.userId),
          db.from("conversations").select("id", { count: "exact", head: true }).eq("user_id", ctx.userId),
        ]);
        const data = { memories: memoryCount ?? 0, documents: docCount ?? 0, conversations: convoCount ?? 0 };
        return { ok: true, summary: JSON.stringify(data), data };
      },
    },
    {
      id: "getApplicationData",
      name: "Get Application Data",
      description: "Fetch data from a connected application through its registered endpoint.",
      parameters: { application: "string" },
      permissions: ["application:read"],
      destructive: false,
      execute: async (ctx: ToolContext) => {
        const { data: app } = await db
          .from("applications")
          .select("name, api_endpoint, capabilities, status")
          .eq("slug", ctx.application ?? "")
          .maybeSingle();
        if (!app) return { ok: false, summary: "", error: "Application not found in the registry" };
        if (app.status !== "active") return { ok: false, summary: "", error: `${app.name} is not active` };
        if (!app.api_endpoint) {
          return {
            ok: false,
            summary: "",
            error: `${app.name} is registered but has no data endpoint configured yet, so no data could be retrieved.`,
          };
        }
        try {
          // SSRF-guarded: validates scheme/host, blocks private ranges, caps
          // redirects, time and response size. Never call fetch() directly here.
          const res = await safeFetch(app.api_endpoint, { headers: { accept: "application/json" } });
          if (res.status < 200 || res.status >= 300) {
            return { ok: false, summary: "", error: `${app.name} returned status ${res.status}` };
          }
          let payload: unknown;
          try {
            payload = JSON.parse(res.body);
          } catch {
            return { ok: false, summary: "", error: `${app.name} returned a non-JSON response` };
          }
          return { ok: true, summary: JSON.stringify(payload).slice(0, CONTEXT_LIMITS.maxToolSummaryChars), data: payload };
        } catch (error) {
          if (error instanceof OutboundUrlError) {
            // Safe to surface: describes policy, never the internal response.
            return { ok: false, summary: "", error: `${app.name} endpoint rejected by connector policy: ${error.message}` };
          }
          return { ok: false, summary: "", error: `${app.name} could not be reached` };
        }
      },

    },
    {
      id: "analyzeData",
      name: "Analyze Data",
      description: "Prepare retrieved metrics for analysis by the model.",
      parameters: { application: "string" },
      permissions: ["application:read"],
      destructive: false,
      execute: async () => ({
        ok: true,
        summary: "Analysis will be performed over any data returned by other tools in this request.",
      }),
    },
  ];

  return Object.fromEntries(tools.map((t) => [t.id, t]));
}

export function listToolIds(db: Db): string[] {
  return Object.keys(makeRegistry(db));
}

export interface ToolRunOutcome extends ToolResult {
  toolId: string;
  durationMs: number;
}

export async function runTool(
  db: Db,
  toolId: string,
  ctx: ToolContext,
  options: { confirmed?: boolean; conversationId?: string; requestId?: string } = {},
): Promise<ToolRunOutcome> {
  const started = Date.now();
  const tool = makeRegistry(db)[toolId];
  if (!tool) {
    return { toolId, ok: false, summary: "", error: "Unknown tool", durationMs: 0 };
  }

  const budget = await enforceToolRateLimit(ctx.userId);
  if (!budget.allowed) {
    const throttled: ToolRunOutcome = {
      toolId,
      ok: false,
      summary: "",
      error: "Tool execution rate limit exceeded",
      durationMs: Date.now() - started,
    };
    await logExecution(db, ctx.userId, tool.id, ctx.application, options.conversationId, options.requestId, throttled);
    return throttled;
  }



  const decision = await authorizeTool(db, {
    userId: ctx.userId,
    isAdmin: await isAdmin(db, ctx.userId),
    application: ctx.application,
    toolSlug: tool.id,
    toolPermissions: tool.permissions,
    destructive: tool.destructive,
    confirmed: options.confirmed ?? false,
  });

  if (!decision.allowed) {
    const outcome: ToolRunOutcome = {
      toolId,
      ok: false,
      summary: "",
      error: decision.reason ?? "Not authorized",
      durationMs: Date.now() - started,
    };
    if (decision.requiresConfirmation) {
      outcome.actions = [{ type: "confirmation_required", payload: { tool: tool.id } }];
    }
    await logExecution(db, ctx.userId, tool.id, ctx.application, options.conversationId, options.requestId, outcome);
    return outcome;
  }

  try {
    const result = await tool.execute(ctx);
    const outcome: ToolRunOutcome = { toolId, ...result, durationMs: Date.now() - started };
    await logExecution(db, ctx.userId, tool.id, ctx.application, options.conversationId, options.requestId, outcome);
    return outcome;
  } catch (error) {
    const outcome: ToolRunOutcome = {
      toolId,
      ok: false,
      summary: "",
      error: error instanceof Error ? error.message : "Tool execution failed",
      durationMs: Date.now() - started,
    };
    await logExecution(db, ctx.userId, tool.id, ctx.application, options.conversationId, options.requestId, outcome);
    return outcome;
  }
}

async function logExecution(
  db: Db,
  userId: string,
  toolSlug: string,
  application: string | undefined,
  conversationId: string | undefined,
  requestId: string | undefined,
  outcome: ToolRunOutcome,
): Promise<void> {
  await db.from("tool_executions").insert({
    user_id: userId,
    tool_slug: toolSlug,
    conversation_id: conversationId ?? null,
    request_id: requestId ?? null,
    application: application ?? null,
    success: outcome.ok,
    duration_ms: outcome.durationMs,
    error: outcome.error ?? null,
  });
}
