import { CONTEXT_LIMITS } from "./config.server";
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

/** Neutralises delimiter spoofing inside retrieved (untrusted) content. */
function sanitizeRetrieved(text: string, max: number): string {
  return text
    .replace(/<\/?untrusted[^>]*>/gi, "[redacted-tag]")
    .replace(/\bsystem\s*:/gi, "system-")
    .slice(0, max)
    .trim();
}

export function renderContextBlock(context: BrainContext): string {
  const parts: string[] = [];
  if (context.application) parts.push(`Active application: ${context.application}`);
  if (context.page) parts.push(`Current page: ${context.page}`);
  if (Object.keys(context.clientContext).length > 0) {
    parts.push(
      `Client context: ${sanitizeRetrieved(JSON.stringify(context.clientContext), CONTEXT_LIMITS.maxClientContextChars)}`,
    );
  }
  if (context.summary) {
    parts.push(`Conversation summary: ${sanitizeRetrieved(context.summary, 2000)}`);
  }

  // Everything below is untrusted retrieved data. It is explicitly framed so the
  // model treats it as reference material, never as instructions.
  if (context.relevantMemories.length > 0) {
    parts.push(
      `<untrusted-memory>\n${context.relevantMemories
        .map((m) => `- ${sanitizeRetrieved(m.content, 600)}`)
        .join("\n")}\n</untrusted-memory>`,
    );
  }
  if (context.relevantDocuments.length > 0) {
    parts.push(
      `<untrusted-knowledge>\n${context.relevantDocuments
        .map(
          (d) =>
            `- [source: ${sanitizeRetrieved(d.title, 120)} | id: ${d.id}] ${sanitizeRetrieved(
              d.content,
              CONTEXT_LIMITS.maxDocumentExcerptChars,
            )}`,
        )
        .join("\n")}\n</untrusted-knowledge>`,
    );
  }

  return parts.join("\n\n").slice(0, CONTEXT_LIMITS.maxContextBlockChars);
}

