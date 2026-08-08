import type { Db } from "./db.server";
import { loadPersonality } from "./personality.server";
import { searchMemories } from "./memory.server";
import { searchKnowledge } from "./rag.server";
import type { BrainContext, RetrievedChunk, RetrievedMemory } from "./types";

/**
 * Context engine — assembles only what the current request needs, rather than
 * shipping whole conversations or the database to the model.
 */

const RECENT_MESSAGE_LIMIT = 8;

export interface ContextInput {
  userId: string;
  conversationId: string;
  message: string;
  application?: string | undefined;
  page?: string | undefined;
  clientContext?: Record<string, unknown> | undefined;
  queryEmbedding?: number[] | undefined;
  needsMemory: boolean;
  needsRag: boolean;
}

export interface ContextResult {
  context: BrainContext;
  memoryMs: number;
  ragMs: number;
}

export async function assembleContext(db: Db, input: ContextInput): Promise<ContextResult> {
  const [personality, recent, summaryRow] = await Promise.all([
    loadPersonality(db, input.userId),
    db
      .from("messages")
      .select("role, content")
      .eq("conversation_id", input.conversationId)
      .order("created_at", { ascending: false })
      .limit(RECENT_MESSAGE_LIMIT),
    db
      .from("conversation_summaries")
      .select("summary")
      .eq("conversation_id", input.conversationId)
      .maybeSingle(),
  ]);

  let relevantMemories: RetrievedMemory[] = [];
  let memoryMs = 0;
  if (input.needsMemory && input.queryEmbedding) {
    const t = Date.now();
    relevantMemories = await searchMemories(db, input.userId, input.queryEmbedding, {
      limit: 5,
      application: input.application,
    }).catch(() => []);
    memoryMs = Date.now() - t;
  }

  let relevantDocuments: RetrievedChunk[] = [];
  let ragMs = 0;
  if (input.needsRag && input.queryEmbedding) {
    const t = Date.now();
    relevantDocuments = await searchKnowledge(db, input.userId, input.queryEmbedding, {
      limit: 4,
      application: input.application,
    }).catch(() => []);
    ragMs = Date.now() - t;
  }

  const context: BrainContext = {
    userId: input.userId,
    application: input.application,
    page: input.page,
    conversationId: input.conversationId,
    currentTask: input.message.slice(0, 200),
    clientContext: input.clientContext ?? {},
    recentMessages: (recent.data ?? []).slice().reverse(),
    summary: summaryRow.data?.summary,
    relevantMemories: relevantMemories.filter((m) => m.similarity > 0.55),
    relevantDocuments: relevantDocuments.filter((d) => d.similarity > 0.55),
    personality,
  };

  return { context, memoryMs, ragMs };
}

export function renderContextBlock(context: BrainContext): string {
  const parts: string[] = [];
  if (context.application) parts.push(`Active application: ${context.application}`);
  if (context.page) parts.push(`Current page: ${context.page}`);
  if (Object.keys(context.clientContext).length > 0) {
    parts.push(`Client context: ${JSON.stringify(context.clientContext).slice(0, 1000)}`);
  }
  if (context.summary) parts.push(`Conversation summary: ${context.summary}`);
  if (context.relevantMemories.length > 0) {
    parts.push(`Known about this user:\n${context.relevantMemories.map((m) => `- ${m.content}`).join("\n")}`);
  }
  if (context.relevantDocuments.length > 0) {
    parts.push(
      `Knowledge excerpts:\n${context.relevantDocuments
        .map((d) => `- [${d.title}] ${d.content.slice(0, 800)}`)
        .join("\n")}`,
    );
  }
  return parts.join("\n\n");
}
