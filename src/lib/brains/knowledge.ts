/**
 * Knowledge pipeline primitives — pure, runtime-agnostic (workerd + vitest).
 * Extraction for TXT/MD/CSV is synchronous; PDF/DOCX use lazily loaded,
 * worker-compatible libraries (unpdf, fflate).
 */

export const KNOWLEDGE_LIMITS = {
  maxFileBytes: 10 * 1024 * 1024,
  maxTextChars: 400_000,
  chunkSize: 1200,
  chunkOverlap: 150,
  maxChunks: 400,
} as const;

export const SUPPORTED_TYPES = ["pdf", "docx", "txt", "md", "csv"] as const;
export type SupportedType = (typeof SUPPORTED_TYPES)[number];

export interface ExtractedPage {
  page: number | null;
  text: string;
}

export interface KnowledgeChunk {
  index: number;
  content: string;
  page: number | null;
  section: string | null;
}

export function detectFileType(filename: string): SupportedType | null {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  if (ext === "markdown") return "md";
  return (SUPPORTED_TYPES as readonly string[]).includes(ext) ? (ext as SupportedType) : null;
}

/** Magic-byte check so a renamed binary cannot masquerade as a supported type. */
export function sniffMatches(type: SupportedType, bytes: Uint8Array): boolean {
  if (type === "pdf") return bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
  if (type === "docx") return bytes[0] === 0x50 && bytes[1] === 0x4b;
  // Text formats: reject NUL bytes in the first 4 KB.
  return !bytes.subarray(0, 4096).includes(0);
}

export function normalizeText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function sha256Hex(input: string | Uint8Array): Promise<string> {
  const data = typeof input === "string" ? new TextEncoder().encode(input) : input;
  const digest = await crypto.subtle.digest("SHA-256", data as BufferSource);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** CSV → "header: value" lines so rows stay self-describing once chunked. */
export function csvToText(csv: string): string {
  const rows = parseCsv(csv).filter((r) => r.some((c) => c.trim()));
  if (rows.length === 0) return "";
  const [header, ...body] = rows;
  if (!header || body.length === 0) return rows.map((r) => r.join(", ")).join("\n");
  return body
    .map((row, i) => `Row ${i + 1}: ` + header.map((h, j) => `${h.trim() || `col${j + 1}`}: ${(row[j] ?? "").trim()}`).join("; "))
    .join("\n\n");
}

function parseCsv(csv: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i]!;
    if (quoted) {
      if (ch === '"' && csv[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && csv[i + 1] === "\n") i++;
      row.push(cell); out.push(row); row = []; cell = "";
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); out.push(row); }
  return out;
}

export function docxXmlToText(xml: string): string {
  return xml
    .replace(/<w:tab\/>/g, "\t")
    .replace(/<w:br[^>]*\/>/g, "\n")
    .replace(/<\/w:p>/g, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

export async function extractPages(type: SupportedType, bytes: Uint8Array): Promise<ExtractedPage[]> {
  if (type === "pdf") {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const { text } = await extractText(pdf, { mergePages: false });
    return (text as string[]).map((t, i) => ({ page: i + 1, text: normalizeText(t) })).filter((p) => p.text);
  }
  if (type === "docx") {
    const { unzipSync, strFromU8 } = await import("fflate");
    const files = unzipSync(bytes, { filter: (f) => f.name === "word/document.xml" });
    const xml = files["word/document.xml"];
    if (!xml) throw new Error("Not a valid DOCX file");
    return [{ page: null, text: normalizeText(docxXmlToText(strFromU8(xml))) }];
  }
  const raw = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  return [{ page: null, text: normalizeText(type === "csv" ? csvToText(raw) : raw) }];
}

const HEADING = /^(#{1,6})\s+(.+)$|^([A-Z][A-Za-z0-9 ,&/()-]{2,80})\n[=-]{3,}$/m;

/** Page- and heading-aware chunking with overlap. */
export function chunkPages(
  pages: ExtractedPage[],
  size: number = KNOWLEDGE_LIMITS.chunkSize,
  overlap: number = KNOWLEDGE_LIMITS.chunkOverlap,
): KnowledgeChunk[] {
  const chunks: KnowledgeChunk[] = [];
  let section: string | null = null;
  for (const page of pages) {
    // Split each page into heading-delimited blocks first.
    const blocks = page.text.split(/\n(?=#{1,6}\s)/);
    for (const block of blocks) {
      const h = HEADING.exec(block);
      if (h) section = (h[2] ?? h[3] ?? "").trim().slice(0, 160) || section;
      let start = 0;
      while (start < block.length) {
        let end = Math.min(start + size, block.length);
        if (end < block.length) {
          const bp = block.lastIndexOf("\n\n", end);
          const sp = block.lastIndexOf(". ", end);
          if (bp > start + size * 0.5) end = bp;
          else if (sp > start + size * 0.5) end = sp + 1;
        }
        const content = block.slice(start, end).trim();
        if (content) chunks.push({ index: chunks.length, content, page: page.page, section });
        if (end >= block.length) break;
        start = Math.max(end - overlap, start + 1);
      }
    }
  }
  return chunks.slice(0, KNOWLEDGE_LIMITS.maxChunks);
}

// ---------------------------------------------------------------- retrieval

export interface RetrievalCandidate {
  id: string;
  document_id: string;
  title: string;
  content: string;
  page_number: number | null;
  section: string | null;
  source_url: string | null;
  similarity: number;
  keyword_rank: number;
}

export interface RetrievalPolicy {
  minSimilarity: number;
  /** Keyword hits can rescue a slightly lower vector score. */
  keywordBoost: number;
  topK: number;
}

export const DEFAULT_RETRIEVAL: RetrievalPolicy = { minSimilarity: 0.55, keywordBoost: 0.08, topK: 5 };

/** Score, threshold, deduplicate and bound candidates. Similarity is a ranking signal, never proof. */
export function selectEvidence(candidates: RetrievalCandidate[], policy: RetrievalPolicy = DEFAULT_RETRIEVAL) {
  const scored = candidates
    .map((c) => ({ ...c, score: c.similarity + (c.keyword_rank > 0 ? policy.keywordBoost : 0) }))
    .filter((c) => c.score >= policy.minSimilarity)
    .sort((a, b) => b.score - a.score);
  const seen = new Set<string>();
  const out: typeof scored = [];
  for (const c of scored) {
    const key = c.content.toLowerCase().replace(/\s+/g, " ").slice(0, 200);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
    if (out.length >= policy.topK) break;
  }
  return out;
}

/** Follow-ups ("what about page 3?") get the previous user turn folded in. */
export function buildRetrievalQuery(message: string, previousUserMessage?: string): string {
  const m = message.trim();
  const isFollowUp =
    m.length < 80 && /\b(it|that|this|those|they|them|more|also|what about|and|same|above|previous)\b/i.test(m);
  return isFollowUp && previousUserMessage ? `${previousUserMessage.trim().slice(0, 400)}\n${m}` : m;
}

// ---------------------------------------------------------------- citations

export interface CitableSource {
  label: string; // "S1"
  id: string;
  documentId: string;
  title: string;
  page: number | null;
  section: string | null;
}

/** Find [S#] markers; markers that don't map to supplied evidence are invalid (fabricated). */
export function validateCitations(text: string, sources: CitableSource[]) {
  const labels = new Set(sources.map((s) => s.label));
  const used = new Set<string>();
  const invalid = new Set<string>();
  for (const m of text.matchAll(/\[(S\d{1,2})\]/g)) {
    const label = m[1]!;
    (labels.has(label) ? used : invalid).add(label);
  }
  // Strip fabricated markers so they never reach the user as if real.
  const cleaned = invalid.size
    ? text.replace(/\[(S\d{1,2})\]/g, (all, l: string) => (labels.has(l) ? all : ""))
    : text;
  return { text: cleaned, used: [...used], invalid: [...invalid] };
}

export function sourceLocator(s: { page: number | null; section: string | null }): string {
  return [s.page != null ? `p. ${s.page}` : null, s.section ? `§ ${s.section}` : null].filter(Boolean).join(", ");
}
