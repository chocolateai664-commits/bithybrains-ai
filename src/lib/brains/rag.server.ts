import { embed, embedBatch } from "./ai/provider.server";
import { toVector, type Db } from "./db.server";
import {
  DEFAULT_RETRIEVAL,
  KNOWLEDGE_LIMITS,
  chunkPages,
  normalizeText,
  selectEvidence,
  sha256Hex,
  type ExtractedPage,
  type RetrievalCandidate,
  type RetrievalPolicy,
} from "./knowledge";
import type { RetrievedChunk } from "./types";

/**
 * RAG engine: ingestion (extract -> clean -> chunk -> embed -> store) and
 * hybrid retrieval. Every query runs through the caller's RLS-scoped client.
 */

export interface IngestInput {
  title: string;
  pages: ExtractedPage[];
  fileType?: string | undefined;
  application?: string | undefined;
  sourceFilename?: string | undefined;
  sourceUrl?: string | undefined;
  byteSize?: number | undefined;
}

export interface IngestResult {
  documentId: string;
  chunks: number;
  duplicate: boolean;
}

/** Backwards-compatible text ingestion. */
export async function ingestDocument(
  db: Db,
  userId: string,
  input: { title: string; text: string; fileType?: string | undefined; application?: string | undefined },
): Promise<IngestResult> {
  return ingestPages(db, userId, {
    title: input.title,
    pages: [{ page: null, text: normalizeText(input.text) }],
    fileType: input.fileType ?? "txt",
    application: input.application,
  });
}

export async function ingestPages(db: Db, userId: string, input: IngestInput): Promise<IngestResult> {
  const fullText = input.pages.map((p) => p.text).join("\n\n");
  if (!fullText.trim()) throw new Error("Document contained no readable text");
  if (fullText.length > KNOWLEDGE_LIMITS.maxTextChars) throw new Error("Document text exceeds the size limit");
  const contentHash = await sha256Hex(fullText);

  // Duplicate detection: same owner + same content hash.
  const { data: existing } = await db
    .from("documents")
    .select("id, status, chunk_count")
    .eq("content_hash", contentHash)
    .maybeSingle();
  if (existing && existing.status === "ready") {
    return { documentId: existing.id, chunks: existing.chunk_count, duplicate: true };
  }

  let documentId = existing?.id;
  if (!documentId) {
    const { data: doc, error } = await db
      .from("documents")
      .insert({
        user_id: userId,
        title: input.title,
        file_type: input.fileType ?? null,
        application: input.application ?? null,
        status: "processing",
        content_hash: contentHash,
        source_filename: input.sourceFilename ?? null,
        source_url: input.sourceUrl ?? null,
        byte_size: input.byteSize ?? null,
        page_count: input.pages.some((p) => p.page != null) ? input.pages.length : null,
      })
      .select("id")
      .single();
    if (error || !doc) throw new Error(error?.message ?? "Could not create document");
    documentId = doc.id;
  }

  return indexDocument(db, userId, documentId, input.pages, input.application);
}

/** (Re)index: idempotent — existing chunks are replaced, never duplicated. */
export async function indexDocument(
  db: Db,
  userId: string,
  documentId: string,
  pages: ExtractedPage[],
  application?: string | undefined,
): Promise<IngestResult> {
  const { data: current } = await db.from("documents").select("attempts").eq("id", documentId).maybeSingle();
  await db
    .from("documents")
    .update({ status: "processing", error: null, attempts: (current?.attempts ?? 0) + 1 })
    .eq("id", documentId);
  try {
    const chunks = chunkPages(pages);
    if (chunks.length === 0) throw new Error("Document contained no readable text");
    const vectors = await embedBatch(chunks.map((c) => (c.section ? `${c.section}\n${c.content}` : c.content)));

    await db.from("document_chunks").delete().eq("document_id", documentId);
    const rows = chunks.map((c) => ({
      document_id: documentId,
      user_id: userId,
      chunk_index: c.index,
      content: c.content,
      page_number: c.page,
      section: c.section,
      application: application ?? null,
      embedding: toVector(vectors[c.index] ?? []),
    }));
    for (let i = 0; i < rows.length; i += 100) {
      const { error } = await db.from("document_chunks").insert(rows.slice(i, i + 100));
      if (error) throw new Error(error.message);
    }
    await db.from("documents").update({ status: "ready", chunk_count: chunks.length, error: null }).eq("id", documentId);
    return { documentId, chunks: chunks.length, duplicate: false };
  } catch (err) {
    const message = (err instanceof Error ? err.message : "Ingestion failed").slice(0, 300);
    await db.from("documents").update({ status: "failed", error: message }).eq("id", documentId);
    throw err;
  }
}

/** Re-index from stored chunks (e.g. after an embedding/chunking change or a failure). */
export async function reindexDocument(db: Db, userId: string, documentId: string): Promise<IngestResult> {
  const { data: doc } = await db.from("documents").select("id, application").eq("id", documentId).maybeSingle();
  if (!doc) throw new Error("Document not found");
  const { data: chunks } = await db
    .from("document_chunks")
    .select("content, page_number, chunk_index")
    .eq("document_id", documentId)
    .order("chunk_index");
  if (!chunks || chunks.length === 0) throw new Error("No stored text to re-index; upload the file again");
  const pages: ExtractedPage[] = [];
  for (const c of chunks) {
    const last = pages[pages.length - 1];
    if (last && last.page === c.page_number) last.text += "\n\n" + c.content;
    else pages.push({ page: c.page_number, text: c.content });
  }
  return indexDocument(db, userId, documentId, pages, doc.application ?? undefined);
}

export interface EvidenceResult {
  evidence: RetrievedChunk[];
  candidates: number;
  latencyMs: number;
  error?: string;
}

const RETRIEVAL_TIMEOUT_MS = 4_000;

/** Hybrid (vector + keyword) retrieval with thresholds, dedup and a timeout. */
export async function retrieveEvidence(
  db: Db,
  userId: string,
  input: { query: string; embedding: number[]; application?: string | undefined; policy?: RetrievalPolicy },
): Promise<EvidenceResult> {
  const started = Date.now();
  const policy = input.policy ?? DEFAULT_RETRIEVAL;
  const args: {
    query_embedding: string;
    query_text: string;
    match_user_id: string;
    match_count: number;
    filter_application?: string;
  } = {
    query_embedding: toVector(input.embedding),
    query_text: input.query.slice(0, 500),
    match_user_id: userId,
    match_count: Math.min(policy.topK * 2, 20),
  };
  if (input.application) args.filter_application = input.application;

  try {
    const call = db.rpc("match_document_chunks_hybrid", args);
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("retrieval_timeout")), RETRIEVAL_TIMEOUT_MS),
    );
    const { data, error } = await Promise.race([call, timeout]);
    if (error) throw new Error(error.message);
    const candidates = (data ?? []) as RetrievalCandidate[];
    const selected = selectEvidence(candidates, policy);
    return {
      evidence: selected.map((c) => ({
        id: c.id,
        document_id: c.document_id,
        title: c.title,
        content: c.content,
        similarity: c.similarity,
        page_number: c.page_number,
        section: c.section,
        source_url: c.source_url,
        keyword_match: c.keyword_rank > 0,
      })),
      candidates: candidates.length,
      latencyMs: Date.now() - started,
    };
  } catch (err) {
    return {
      evidence: [],
      candidates: 0,
      latencyMs: Date.now() - started,
      error: err instanceof Error ? err.message.slice(0, 120) : "retrieval_failed",
    };
  }
}

/** Legacy vector-only search (used by the searchKnowledge tool). */
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

/** Cheap check so retrieval is skipped for users with no indexed knowledge. */
export async function hasReadyDocuments(db: Db): Promise<boolean> {
  const { count } = await db.from("documents").select("id", { count: "exact", head: true }).eq("status", "ready");
  return (count ?? 0) > 0;
}
