import { embed } from "./ai/provider.server";
import { toVector, type Db } from "./db.server";
import type { RetrievedMemory } from "./types";

/**
 * Memory engine: retrieval, policy, deduplication and writes.
 * All queries run through the caller's authenticated client, so RLS guarantees
 * one user can never retrieve another user's memories.
 */

export interface MemoryPolicyDecision {
  store: boolean;
  reason: "useful_long_term" | "conversational" | "temporary" | "sensitive" | "irrelevant";
  type: string;
  importance: number;
  confidence: number;
  content: string;
}

const SENSITIVE = /\b(password|passcode|api[ _-]?key|secret|ssn|credit card|cvv|bank account|token)\b/i;
const DURABLE = /\b(i (prefer|like|always|usually|work|use|am)|my (name|role|team|project|timezone|goal|workflow)|call me|remember that)\b/i;
const TEMPORARY = /\b(today|right now|at the moment|just now|this minute)\b/i;

export function applyMemoryPolicy(message: string): MemoryPolicyDecision {
  const content = message.trim();
  const base = { content, confidence: 0.7 };

  if (SENSITIVE.test(content)) {
    return { ...base, store: false, reason: "sensitive", type: "user", importance: 0 };
  }
  if (content.length < 12) {
    return { ...base, store: false, reason: "irrelevant", type: "user", importance: 0 };
  }
  if (DURABLE.test(content)) {
    return { ...base, store: true, reason: "useful_long_term", type: "user", importance: 0.8, confidence: 0.8 };
  }
  if (TEMPORARY.test(content)) {
    return { ...base, store: false, reason: "temporary", type: "conversation", importance: 0.2 };
  }
  return { ...base, store: false, reason: "conversational", type: "conversation", importance: 0.3 };
}

export async function searchMemories(
  db: Db,
  userId: string,
  queryEmbedding: number[],
  options: { limit?: number; application?: string | undefined; type?: string | undefined } = {},
): Promise<RetrievedMemory[]> {
  const { data, error } = await db.rpc("match_memories", {
    query_embedding: toVector(queryEmbedding) as unknown as string,
    match_user_id: userId,
    match_count: options.limit ?? 5,
    filter_application: options.application ?? null,
    filter_type: options.type ?? null,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as RetrievedMemory[];
}

/** Dedupe-aware write: update a near-duplicate instead of creating a new row. */
export async function rememberIfUseful(
  db: Db,
  userId: string,
  decision: MemoryPolicyDecision,
  options: { application?: string | undefined; source?: string } = {},
): Promise<{ stored: boolean; deduped: boolean }> {
  if (!decision.store) return { stored: false, deduped: false };

  const embedding = await embed(decision.content);
  const existing = await searchMemories(db, userId, embedding, { limit: 1 });
  const nearest = existing[0];

  if (nearest && nearest.similarity > 0.92) {
    const { error } = await db
      .from("memories")
      .update({
        content: decision.content,
        importance: Math.max(nearest.importance, decision.importance),
        confidence: decision.confidence,
        embedding: toVector(embedding) as unknown as string,
      })
      .eq("id", nearest.id);
    if (error) throw new Error(error.message);
    return { stored: true, deduped: true };
  }

  const { error } = await db.from("memories").insert({
    user_id: userId,
    content: decision.content,
    memory_type: decision.type,
    application: options.application ?? null,
    importance: decision.importance,
    confidence: decision.confidence,
    source: options.source ?? "conversation",
    embedding: toVector(embedding) as unknown as string,
  });
  if (error) throw new Error(error.message);
  return { stored: true, deduped: false };
}
