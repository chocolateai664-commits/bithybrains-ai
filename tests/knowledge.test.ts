import { describe, expect, it } from "vitest";
import { zipSync, strToU8 } from "fflate";
import {
  buildRetrievalQuery,
  chunkPages,
  csvToText,
  detectFileType,
  extractPages,
  selectEvidence,
  sha256Hex,
  sniffMatches,
  sourceLocator,
  validateCitations,
  type RetrievalCandidate,
} from "../src/lib/brains/knowledge";

const cand = (id: string, similarity: number, content = `content ${id}`, keyword_rank = 0): RetrievalCandidate => ({
  id, document_id: "d1", title: "Guide", content, page_number: 2, section: "Intro", source_url: null, similarity, keyword_rank,
});

describe("file validation", () => {
  it("detects supported types and rejects others", () => {
    expect(detectFileType("a.PDF")).toBe("pdf");
    expect(detectFileType("notes.markdown")).toBe("md");
    expect(detectFileType("evil.exe")).toBeNull();
  });
  it("rejects renamed binaries via magic bytes", () => {
    expect(sniffMatches("pdf", strToU8("%PDF-1.7"))).toBe(true);
    expect(sniffMatches("pdf", strToU8("hello"))).toBe(false);
    expect(sniffMatches("txt", new Uint8Array([104, 0, 105]))).toBe(false);
  });
});

describe("extraction", () => {
  it("extracts DOCX paragraphs", async () => {
    const xml = '<w:document><w:body><w:p><w:r><w:t>Hello &amp; welcome</w:t></w:r></w:p><w:p><w:r><w:t>Second</w:t></w:r></w:p></w:body></w:document>';
    const docx = zipSync({ "word/document.xml": strToU8(xml) });
    const pages = await extractPages("docx", docx);
    expect(pages[0]!.text).toContain("Hello & welcome");
    expect(pages[0]!.text).toContain("Second");
  });
  it("rejects malformed DOCX", async () => {
    await expect(extractPages("docx", zipSync({ "x.txt": strToU8("x") }))).rejects.toThrow();
  });
  it("turns CSV rows into self-describing text", () => {
    expect(csvToText('name,port\n"Lagos, NG",Apapa\n')).toBe("Row 1: name: Lagos, NG; port: Apapa");
  });
});

describe("chunking + hashing", () => {
  it("preserves page numbers and headings", () => {
    const chunks = chunkPages([
      { page: 1, text: "# Shipping\nContainers move by sea." },
      { page: 2, text: "Customs clearance takes two days." },
    ]);
    expect(chunks[0]).toMatchObject({ page: 1, section: "Shipping" });
    expect(chunks[1]).toMatchObject({ page: 2, section: "Shipping" });
  });
  it("splits long text with overlap and bounded size", () => {
    const text = Array.from({ length: 200 }, (_, i) => `Sentence number ${i} about logistics.`).join(" ");
    const chunks = chunkPages([{ page: null, text }], 300, 50);
    expect(chunks.length).toBeGreaterThan(5);
    expect(chunks.every((c) => c.content.length <= 300)).toBe(true);
  });
  it("hashes identically for identical content (duplicate detection)", async () => {
    expect(await sha256Hex("abc")).toBe(await sha256Hex("abc"));
    expect(await sha256Hex("abc")).not.toBe(await sha256Hex("abd"));
  });
});

describe("retrieval selection", () => {
  it("applies threshold, top-k and dedup", () => {
    const out = selectEvidence(
      [cand("a", 0.9), cand("b", 0.9, "content a"), cand("c", 0.3), cand("d", 0.7)],
      { minSimilarity: 0.55, keywordBoost: 0.08, topK: 5 },
    );
    expect(out.map((c) => c.id)).toEqual(["a", "d"]);
  });
  it("keyword hits rescue borderline vector scores (hybrid)", () => {
    const out = selectEvidence([cand("k", 0.5, "x", 0.2)], { minSimilarity: 0.55, keywordBoost: 0.08, topK: 3 });
    expect(out).toHaveLength(1);
  });
  it("returns nothing when no evidence is relevant", () => {
    expect(selectEvidence([cand("a", 0.1)])).toHaveLength(0);
  });
  it("folds the previous question into follow-ups", () => {
    expect(buildRetrievalQuery("what about that?", "Apapa port fees")).toContain("Apapa port fees");
    expect(buildRetrievalQuery("Explain customs clearance in Nigeria in detail please", "x")).not.toContain("x\n");
  });
});

describe("citations", () => {
  const sources = [{ label: "S1", id: "c1", documentId: "d1", title: "Guide", page: 3, section: null }];
  it("accepts real markers and strips fabricated ones", () => {
    const r = validateCitations("Fees are fixed [S1]. Also [S7].", sources);
    expect(r.used).toEqual(["S1"]);
    expect(r.invalid).toEqual(["S7"]);
    expect(r.text).not.toContain("[S7]");
    expect(r.text).toContain("[S1]");
  });
  it("formats page/section locators", () => {
    expect(sourceLocator({ page: 3, section: "Fees" })).toBe("p. 3, § Fees");
  });
});
