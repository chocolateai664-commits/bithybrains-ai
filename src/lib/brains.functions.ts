import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/** Typed RPC surface used by the Bithy Brains control center UI. */

export const getBrainOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();

    const [memories, documents, chunks, conversations, requests, executions, apps, tools, models, admin] =
      await Promise.all([
        supabase.from("memories").select("id", { count: "exact", head: true }),
        supabase.from("documents").select("id", { count: "exact", head: true }),
        supabase.from("document_chunks").select("id", { count: "exact", head: true }),
        supabase.from("conversations").select("id", { count: "exact", head: true }),
        supabase
          .from("ai_requests")
          .select("latency_ms, memory_ms, rag_ms, prompt_tokens, completion_tokens, estimated_cost, success, intent, model_id, created_at")
          .gte("created_at", since)
          .order("created_at", { ascending: false })
          .limit(500),
        supabase
          .from("tool_executions")
          .select("tool_slug, success, duration_ms")
          .gte("created_at", since)
          .limit(500),
        supabase.from("applications").select("*").order("name"),
        supabase.from("tools").select("*").order("name"),
        supabase.from("ai_models").select("*").order("priority"),
        supabase.from("user_roles").select("role").eq("user_id", userId).eq("role", "admin").maybeSingle(),
      ]);

    const reqRows = requests.data ?? [];
    const successful = reqRows.filter((r) => r.success).length;
    const avg = (nums: number[]) => (nums.length ? Math.round(nums.reduce((a, b) => a + b, 0) / nums.length) : 0);

    const toolStats = new Map<string, { runs: number; failures: number; avgMs: number[] }>();
    for (const row of executions.data ?? []) {
      const entry = toolStats.get(row.tool_slug) ?? { runs: 0, failures: 0, avgMs: [] };
      entry.runs += 1;
      if (!row.success) entry.failures += 1;
      entry.avgMs.push(row.duration_ms);
      toolStats.set(row.tool_slug, entry);
    }

    return {
      isAdmin: !!admin.data,
      health: {
        api: "operational" as const,
        database: memories.error ? ("degraded" as const) : ("operational" as const),
        vectorSearch: chunks.error ? ("degraded" as const) : ("operational" as const),
        aiProviders: reqRows.length === 0 ? ("idle" as const) : successful > 0 ? ("operational" as const) : ("degraded" as const),
      },
      usage: {
        requests: reqRows.length,
        successful,
        failed: reqRows.length - successful,
        tokens: reqRows.reduce((a, r) => a + r.prompt_tokens + r.completion_tokens, 0),
        cost: Number(reqRows.reduce((a, r) => a + Number(r.estimated_cost), 0).toFixed(4)),
        avgLatencyMs: avg(reqRows.map((r) => r.latency_ms)),
        avgMemoryMs: avg(reqRows.map((r) => r.memory_ms)),
        avgRagMs: avg(reqRows.map((r) => r.rag_ms)),
      },
      knowledge: {
        memories: memories.count ?? 0,
        documents: documents.count ?? 0,
        embeddings: (chunks.count ?? 0) + (memories.count ?? 0),
        conversations: conversations.count ?? 0,
      },
      applications: apps.data ?? [],
      tools: (tools.data ?? []).map((t) => {
        const stat = toolStats.get(t.slug);
        return {
          ...t,
          runs: stat?.runs ?? 0,
          failures: stat?.failures ?? 0,
          avgMs: avg(stat?.avgMs ?? []),
        };
      }),
      models: models.data ?? [],
      recentRequests: reqRows.slice(0, 15),
    };
  });

export const listMemories = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("memories")
      .select("id, content, memory_type, importance, confidence, source, application, created_at")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return data;
  });

export const deleteMemory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("memories").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listAuditEvents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        search: z.string().trim().max(120).optional(),
        requestId: z.string().uuid().optional(),
        from: z.string().datetime().optional(),
        to: z.string().datetime().optional(),
        limit: z.number().int().min(10).max(200).default(100),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // RLS decides visibility: admins see every row, everyone else only their own.
    const withFilters = <T extends { gte: (c: string, v: string) => T; lte: (c: string, v: string) => T; eq: (c: string, v: string) => T }>(
      q: T,
    ): T => {
      let out = q;
      if (data.from) out = out.gte("created_at", data.from);
      if (data.to) out = out.lte("created_at", data.to);
      if (data.requestId) out = out.eq("request_id", data.requestId);
      return out;
    };

    let auditQuery = withFilters(
      supabase
        .from("audit_logs")
        .select("id, user_id, action, resource, request_id, metadata, created_at")
        .order("created_at", { ascending: false })
        .limit(data.limit),
    );
    if (data.search) auditQuery = auditQuery.ilike("action", `%${data.search}%`);

    let toolQuery = withFilters(
      supabase
        .from("tool_executions")
        .select("id, tool_slug, success, duration_ms, application, request_id, error, created_at")
        .order("created_at", { ascending: false })
        .limit(data.limit),
    );
    if (data.search) toolQuery = toolQuery.ilike("tool_slug", `%${data.search}%`);

    let requestQuery = withFilters(
      supabase
        .from("ai_requests")
        .select("id, model_id, provider, intent, success, error, tools_used, request_id, created_at")
        .order("created_at", { ascending: false })
        .limit(data.limit),
    );
    if (data.search) requestQuery = requestQuery.ilike("model_id", `%${data.search}%`);

    const [audit, tools, requests, admin] = await Promise.all([
      auditQuery,
      toolQuery,
      requestQuery,
      supabase.from("user_roles").select("role").eq("user_id", userId).eq("role", "admin").maybeSingle(),
    ]);

    if (audit.error) throw new Error(audit.error.message);

    return {
      isAdmin: !!admin.data,
      scope: admin.data ? ("all" as const) : ("own" as const),
      auditLogs: audit.data ?? [],
      toolExecutions: tools.data ?? [],
      aiRequests: requests.data ?? [],
    };
  });


export const listConversations = createServerFn({ method: "GET" })

  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("conversations")
      .select("id, title, application, created_at, updated_at")
      .order("updated_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return data;
  });

export const listDocuments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("documents")
      .select("id, title, file_type, status, chunk_count, application, error, created_at")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return data;
  });

export const ingestKnowledge = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        title: z.string().trim().min(1).max(200),
        text: z.string().trim().min(20).max(200_000),
        fileType: z.string().trim().max(32).optional(),
        application: z.string().trim().max(64).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { ingestDocument } = await import("@/lib/brains/rag.server");
    return ingestDocument(context.supabase, context.userId, data);
  });

export const getPersonality = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { loadPersonality } = await import("@/lib/brains/personality.server");
    return loadPersonality(context.supabase, context.userId);
  });

export const savePersonality = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        tone: z.string().trim().min(1).max(40),
        style: z.string().trim().min(1).max(40),
        responseLength: z.enum(["short", "medium", "long"]),
        formality: z.string().trim().min(1).max(40),
        language: z.string().trim().min(2).max(10),
        assistantName: z.string().trim().min(1).max(40),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("personality_settings").upsert({
      user_id: context.userId,
      tone: data.tone,
      style: data.style,
      response_length: data.responseLength,
      formality: data.formality,
      language: data.language,
      assistant_name: data.assistantName,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const sendBrainMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        message: z.string().trim().min(1).max(8000),
        conversationId: z.string().uuid().optional(),
        application: z.string().trim().max(64).optional(),
        page: z.string().trim().max(256).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { runBrain } = await import("@/lib/brains/orchestrator.server");
    return runBrain(context.supabase, context.userId, data);
  });
