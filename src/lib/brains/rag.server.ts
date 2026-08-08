import { embed, embedBatch } from "./ai/provider.server";
import { chunkText, toVector, type Db } from "./db.server";
import type { RetrievedChunk } from "./types";

/**
 * RAG engine: ingestion (extract -> clean -> chunk -> embed -> store) and
 * retrieval with per-user metadata filtering.
 */

export async function ingestDocument(
  db: Db,
  userId: string,
  input: { title: string; text: string; fileType?: string | undefined; application?: string | undefined },
): Promise<{ documentId: string; chunks: number }> {
  const { data: doc, error } = await db
    .from("documents")
    .insert({
      user_id: userId,
      title: input.title,
      file_type: input.fileType ?? null,
      application: input.application ?? null,
      status: "processing",
    })
    .select("id")
    .single();
  if (error || !doc) throw new Error(error?.message ?? "Could not create document");

  try {
    const chunks = chunkText(input.text);
    if (chunks.length === 0) throw new Error("Document contained no readable text");

    const vectors = await embedBatch(chunks);
    const rows = chunks.map((content, index) => ({
      document_id: doc.id,
      user_id: userId,
      chunk_index: index,
      content,
      application: input.application ?? null,
      embedding: toVector(vectors[index] ?? []),
    }));

    const { error: chunkError } = await db.from("document_chunks").insert(rows);
    if (chunkError) throw new Error(chunkError.message);

    await db
      .from("documents")
      .update({ status: "ready", chunk_count: chunks.length, error: null })
      .eq("id", doc.id);

    return { documentId: doc.id, chunks: chunks.length };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Ingestion failed";
    await db.from("documents").update({ status: "failed", error: message }).eq("id", doc.id);
    throw err;
  }
}

export async function searchKnowledge(
  db: Db,
  userId: string,
  queryEmbedding: number[],
  options: { limit?: number; application?: string | undefined } = {},
): Promise<RetrievedChunk[]> {
  const args: {
    query_embedding: string;
    match_user_id: string;
    match_count: number;
    filter_application?: string;
  } = {
    query_embedding: toVector(queryEmbedding),
    match_user_id: userId,
    match_count: options.limit ?? 5,
  };
  if (options.application) args.filter_application = options.application;

  const { data, error } = await db.rpc("match_document_chunks", args);
  if (error) throw new Error(error.message);
  return (data ?? []) as RetrievedChunk[];
}

export async function embedQuery(query: string): Promise<number[]> {
  return embed(query);
}
