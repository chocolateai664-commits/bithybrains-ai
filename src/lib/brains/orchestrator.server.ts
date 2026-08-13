import { routeChat } from "./ai/router.server";
import { assembleContext, renderContextBlock } from "./context.server";
import type { Db } from "./db.server";
import { classifyIntent } from "./intent.server";
import { applyMemoryPolicy, rememberIfUseful } from "./memory.server";
import { personaSystemPrompt } from "./personality.server";
import { embedQuery } from "./rag.server";
import { runTool } from "./tools.server";
import type { BrainRequest, BrainResponse, BrainSource, BrainAction } from "./types";

/**
 * Orchestrator — the Bithy Brains pipeline.
 * understand -> context -> memory -> knowledge -> plan -> tools -> model ->
 * response -> memory update. Only safe metadata leaves this layer.
 */

const SUMMARIZE_AFTER = 16;

const TOOL_PLAN: Record<string, string[]> = {
  memory_search: ["searchMemory"],
  knowledge_search: ["searchKnowledge"],
  document_analysis: ["searchKnowledge"],
  data_analysis: ["getDashboardStats", "analyzeData"],
  application_action: ["getApplicationData"],
  task_creation: ["getApplicationData"],
};

export async function runBrain(
  db: Db,
  userId: string,
  request: Omit<BrainRequest, "userId">,
): Promise<BrainResponse> {
  const startedAt = Date.now();
  // Correlation ID: groups every audit event, tool execution and model request
  // produced by this single chat turn.
  const requestId = crypto.randomUUID();
  const decision = classifyIntent(request.message);

  const conversationId = await ensureConversation(db, userId, request);


  await db.from("messages").insert({
    conversation_id: conversationId,
    user_id: userId,
    role: "user",
    content: request.message,
  });

  let queryEmbedding: number[] | undefined;
  if (decision.needsMemory || decision.needsRag || decision.needsTools) {
    queryEmbedding = await embedQuery(request.message).catch(() => undefined);
  }

  const { context, memoryMs, ragMs } = await assembleContext(db, {
    userId,
    conversationId,
    message: request.message,
    application: request.application,
    page: request.page,
    clientContext: request.context,
    queryEmbedding,
    needsMemory: decision.needsMemory,
    needsRag: decision.needsRag,
  });

  const sources: BrainSource[] = context.relevantDocuments.map((d) => ({
    id: d.id,
    title: d.title,
    relevance: Number(d.similarity.toFixed(3)),
  }));
  const actions: BrainAction[] = [];
  const toolsUsed: string[] = [];
  const toolNotes: string[] = [];

  if (decision.needsTools) {
    for (const toolId of TOOL_PLAN[decision.intent] ?? []) {
      const outcome = await runTool(
        db,
        toolId,
        { userId, application: request.application, query: request.message, queryEmbedding },
        { conversationId, requestId },
      );
      toolsUsed.push(toolId);
      if (outcome.ok) {
        if (outcome.summary) toolNotes.push(`Tool ${toolId} result:\n${outcome.summary}`);
        for (const source of outcome.sources ?? []) {
          if (!sources.some((s) => s.id === source.id)) sources.push(source);
        }
      } else {
        toolNotes.push(`Tool ${toolId} FAILED: ${outcome.error ?? "unknown error"}. Do not invent a result.`);
        if (outcome.actions) actions.push(...outcome.actions);
      }
    }
  }

  const contextBlock = renderContextBlock(context);
  const systemPrompt = [
    personaSystemPrompt(context.personality),
    contextBlock ? `\nContext:\n${contextBlock}` : "",
    toolNotes.length > 0 ? `\nTool results:\n${toolNotes.join("\n\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  let text: string;
  let modelId = "none";
  let provider = "none";
  let modelMs = 0;
  let promptTokens = 0;
  let completionTokens = 0;
  let success = true;
  let errorMessage: string | undefined;

  try {
    const result = await routeChat(decision.intent, [
      { role: "system", content: systemPrompt },
      ...context.recentMessages.map((m) => ({
        role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
        content: m.content,
      })),
      { role: "user", content: request.message },
    ]);
    text = result.text.trim() || "I couldn't produce a response for that.";
    modelId = result.modelId;
    provider = result.provider;
    modelMs = result.latencyMs;
    promptTokens = result.promptTokens;
    completionTokens = result.completionTokens;
  } catch (error) {
    success = false;
    errorMessage = error instanceof Error ? error.message : "Model failure";
    text =
      "I couldn't reach an AI model just now, so I haven't completed that request. Please try again in a moment.";
  }

  await db.from("messages").insert({
    conversation_id: conversationId,
    user_id: userId,
    role: "assistant",
    content: text,
    metadata: { intent: decision.intent, tools_used: toolsUsed } as never,
  });

  await db.from("ai_requests").insert({
    user_id: userId,
    conversation_id: conversationId,
    model_id: modelId,
    provider,
    intent: decision.intent,
    tools_used: toolsUsed,
    latency_ms: Date.now() - startedAt,
    memory_ms: memoryMs,
    rag_ms: ragMs,
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    estimated_cost: estimateCost(provider, promptTokens, completionTokens),
    success,
    error: errorMessage ?? null,
  });

  // Memory update — policy-gated and deduplicated.
  await rememberIfUseful(db, userId, applyMemoryPolicy(request.message), {
    application: request.application,
  }).catch(() => undefined);

  await maybeSummarize(db, userId, conversationId);

  const response: BrainResponse = {
    message: text,
    conversationId,
    reasoning: { intent: decision.intent, toolsUsed },
  };
  if (sources.length > 0) response.sources = sources;
  if (actions.length > 0) response.actions = actions;
  return response;
}

function estimateCost(provider: string, promptTokens: number, completionTokens: number): number {
  const rate = provider === "openai" ? 0.000004 : 0.0000008;
  return Number(((promptTokens + completionTokens) * rate).toFixed(6));
}

async function ensureConversation(
  db: Db,
  userId: string,
  request: Omit<BrainRequest, "userId">,
): Promise<string> {
  if (request.conversationId) {
    const { data } = await db
      .from("conversations")
      .select("id")
      .eq("id", request.conversationId)
      .maybeSingle();
    if (data) {
      await db.from("conversations").update({ updated_at: new Date().toISOString() }).eq("id", data.id);
      return data.id;
    }
  }

  const { data, error } = await db
    .from("conversations")
    .insert({
      user_id: userId,
      title: request.message.slice(0, 60),
      application: request.application ?? null,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Could not start a conversation");
  return data.id;
}

async function maybeSummarize(db: Db, userId: string, conversationId: string): Promise<void> {
  try {
    const { count } = await db
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("conversation_id", conversationId);
    if (!count || count < SUMMARIZE_AFTER || count % SUMMARIZE_AFTER !== 0) return;

    const { data: messages } = await db
      .from("messages")
      .select("role, content")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });
    if (!messages) return;

    const transcript = messages.map((m) => `${m.role}: ${m.content}`).join("\n").slice(-12000);
    const result = await routeChat("conversation", [
      {
        role: "system",
        content:
          "Summarize this conversation in under 200 words. Capture decisions, goals and open threads. Output only the summary.",
      },
      { role: "user", content: transcript },
    ]);

    const { data: existing } = await db
      .from("conversation_summaries")
      .select("id")
      .eq("conversation_id", conversationId)
      .maybeSingle();

    if (existing) {
      await db
        .from("conversation_summaries")
        .update({ summary: result.text, message_count: count })
        .eq("id", existing.id);
    } else {
      await db.from("conversation_summaries").insert({
        conversation_id: conversationId,
        user_id: userId,
        summary: result.text,
        message_count: count,
      });
    }
  } catch {
    /* summarization is best-effort */
  }
}
