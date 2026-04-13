import { describe, it, expect } from "vitest";

// Replicate the types and pure functions from the contradiction detection logic in server.ts
type MemRow = {
  id: string;
  content: string;
  detail: string | null;
  domain: string;
  confidence: number;
  entity_type: string | null;
  entity_name: string | null;
  learned_at: string | null;
  confirmed_count: number;
  used_count: number;
  permanence: string | null;
  expires_at: string | null;
  has_pii_flag: number;
  structured_data: string | null;
  confirmed_at: string | null;
};

function wordSet(text: string, entityName?: string | null): Set<string> {
  const excludeWords = new Set((entityName ?? "").toLowerCase().split(/\s+/).filter(w => w.length > 0));
  return new Set(text.toLowerCase().split(/\s+/).filter(w => w.length > 3 && !excludeWords.has(w)));
}

function wordOverlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const item of a) { if (b.has(item)) intersection++; }
  return intersection / Math.min(a.size, b.size);
}

function isDocumentIndex(m: MemRow): boolean {
  if (!m.structured_data) return false;
  try { return JSON.parse(m.structured_data).type === "document"; }
  catch { return false; }
}

function makeMemRow(overrides: Partial<MemRow>): MemRow {
  return {
    id: "0000000000000000",
    content: "",
    detail: null,
    domain: "general",
    confidence: 0.75,
    entity_type: null,
    entity_name: null,
    learned_at: "2026-01-01T00:00:00.000Z",
    confirmed_count: 0,
    used_count: 0,
    permanence: "active",
    expires_at: null,
    has_pii_flag: 0,
    structured_data: null,
    confirmed_at: null,
    ...overrides,
  };
}

/** Runs the contradiction detection logic on an array of MemRows and returns flagged pairs. */
function findContradictions(mems: MemRow[]): Array<[string, string]> {
  const byDomain = new Map<string, MemRow[]>();
  for (const m of mems) {
    const arr = byDomain.get(m.domain) || [];
    arr.push(m);
    byDomain.set(m.domain, arr);
  }

  const results: Array<[string, string]> = [];
  const seen = new Set<string>();

  for (const [, domainMems] of byDomain) {
    if (domainMems.length < 2) continue;
    const memWords = domainMems.map(m => ({
      mem: m,
      words: wordSet(m.content + (m.detail ? " " + m.detail : ""), m.entity_name),
    }));
    for (let i = 0; i < memWords.length; i++) {
      for (let j = i + 1; j < memWords.length; j++) {
        const key = [memWords[i].mem.id, memWords[j].mem.id].sort().join("|");
        if (seen.has(key)) continue;
        const overlap = wordOverlap(memWords[i].words, memWords[j].words);
        if (overlap >= 0.45 && overlap < 0.7) {
          // Skip if both memories were already confirmed (user reviewed them)
          if (memWords[i].mem.confirmed_at && memWords[j].mem.confirmed_at) continue;
          // Skip document index entries — catalog entries, not factual claims
          if (isDocumentIndex(memWords[i].mem) && isDocumentIndex(memWords[j].mem)) continue;
          // Skip if both memories have different entity_name values — they're about different entities
          if (memWords[i].mem.entity_name && memWords[j].mem.entity_name &&
              memWords[i].mem.entity_name.toLowerCase() !== memWords[j].mem.entity_name.toLowerCase()) continue;
          seen.add(key);
          results.push([memWords[i].mem.id, memWords[j].mem.id]);
        }
      }
    }
  }
  return results;
}

describe("interview contradiction detection", () => {
  // Two memories with ~0.57 overlap (share 4 of 7 significant words)
  const contentA = "James prefers using TypeScript for backend development projects";
  const contentB = "James prefers using Python for backend machine learning";

  it("should flag overlapping unconfirmed non-document memories", () => {
    const mems = [
      makeMemRow({ id: "aaa", content: contentA, domain: "tech" }),
      makeMemRow({ id: "bbb", content: contentB, domain: "tech" }),
    ];
    const contradictions = findContradictions(mems);
    expect(contradictions).toHaveLength(1);
    expect(contradictions[0]).toEqual(["aaa", "bbb"]);
  });

  it("should NOT flag pairs where both memories have confirmed_at", () => {
    const mems = [
      makeMemRow({ id: "aaa", content: contentA, domain: "tech", confirmed_at: "2026-04-10T00:00:00.000Z" }),
      makeMemRow({ id: "bbb", content: contentB, domain: "tech", confirmed_at: "2026-04-10T00:00:00.000Z" }),
    ];
    const contradictions = findContradictions(mems);
    expect(contradictions).toHaveLength(0);
  });

  it("should flag when only one memory is confirmed", () => {
    const mems = [
      makeMemRow({ id: "aaa", content: contentA, domain: "tech", confirmed_at: "2026-04-10T00:00:00.000Z" }),
      makeMemRow({ id: "bbb", content: contentB, domain: "tech" }),
    ];
    const contradictions = findContradictions(mems);
    expect(contradictions).toHaveLength(1);
  });

  it("should NOT flag pairs where both are document index entries", () => {
    const docStructured = JSON.stringify({ type: "document", source_system: "notion", location: "notion://page1" });
    const mems = [
      makeMemRow({
        id: "aaa",
        content: "[Document] PA Real Estate Agent v3 — Manages property search and listing analysis for homebuyers",
        domain: "notion",
        entity_type: "resource",
        structured_data: docStructured,
      }),
      makeMemRow({
        id: "bbb",
        content: "[Document] PA Business Ops Agent — Manages property search and operational workflows for teams",
        domain: "notion",
        entity_type: "resource",
        structured_data: JSON.stringify({ type: "document", source_system: "notion", location: "notion://page2" }),
      }),
    ];
    const contradictions = findContradictions(mems);
    expect(contradictions).toHaveLength(0);
  });

  it("should flag document vs non-document memory with sufficient overlap", () => {
    // One is a document index, the other is a regular memory — should still compare
    const mems = [
      makeMemRow({
        id: "aaa",
        content: "James prefers using TypeScript for backend development projects",
        domain: "tech",
        structured_data: JSON.stringify({ type: "document", source_system: "notion", location: "notion://page1" }),
      }),
      makeMemRow({
        id: "bbb",
        content: "James prefers using Python for backend machine learning",
        domain: "tech",
      }),
    ];
    const contradictions = findContradictions(mems);
    expect(contradictions).toHaveLength(1);
  });

  it("should NOT flag when overlap is below threshold", () => {
    const mems = [
      makeMemRow({ id: "aaa", content: "James likes coffee in the morning", domain: "personal" }),
      makeMemRow({ id: "bbb", content: "The deployment pipeline uses GitHub Actions for CI/CD", domain: "personal" }),
    ];
    const contradictions = findContradictions(mems);
    expect(contradictions).toHaveLength(0);
  });

  it("should NOT flag memories in different domains", () => {
    const mems = [
      makeMemRow({ id: "aaa", content: contentA, domain: "work" }),
      makeMemRow({ id: "bbb", content: contentB, domain: "personal" }),
    ];
    const contradictions = findContradictions(mems);
    expect(contradictions).toHaveLength(0);
  });

  it("should handle malformed structured_data gracefully", () => {
    const mems = [
      makeMemRow({ id: "aaa", content: contentA, domain: "tech", structured_data: "not json" }),
      makeMemRow({ id: "bbb", content: contentB, domain: "tech", structured_data: "also not json" }),
    ];
    // Malformed JSON → isDocumentIndex returns false → should still flag as normal contradiction
    const contradictions = findContradictions(mems);
    expect(contradictions).toHaveLength(1);
  });

  // --- Entity-name aware contradiction tests ---

  it("should NOT flag two different people at the same company as contradictions", () => {
    const mems = [
      makeMemRow({
        id: "aaa",
        content: "Evie Grimshaw: Interviewer at Sierra AI, conducts technical interviews",
        domain: "people",
        entity_type: "person",
        entity_name: "Evie Grimshaw",
      }),
      makeMemRow({
        id: "bbb",
        content: "Greg Snyder: Recruiter at Sierra AI, conducts initial screening interviews",
        domain: "people",
        entity_type: "person",
        entity_name: "Greg Snyder",
      }),
    ];
    const contradictions = findContradictions(mems);
    expect(contradictions).toHaveLength(0);
  });

  it("should flag two memories about the same person with conflicting details", () => {
    const mems = [
      makeMemRow({
        id: "aaa",
        content: "Sarah Chen works as a senior engineer at Anthropic on the safety team",
        domain: "people",
        entity_type: "person",
        entity_name: "Sarah Chen",
      }),
      makeMemRow({
        id: "bbb",
        content: "Sarah Chen works as a product manager at Anthropic on the growth team",
        domain: "people",
        entity_type: "person",
        entity_name: "Sarah Chen",
      }),
    ];
    const contradictions = findContradictions(mems);
    expect(contradictions).toHaveLength(1);
  });

  it("should NOT flag complementary memories about the same entity", () => {
    const mems = [
      makeMemRow({
        id: "aaa",
        content: "Sierra AI is a startup founded in 2023 focusing on enterprise conversational AI",
        domain: "companies",
        entity_type: "organization",
        entity_name: "Sierra AI",
      }),
      makeMemRow({
        id: "bbb",
        content: "Sierra AI raised a Series B round led by Sequoia Capital in late 2024",
        domain: "companies",
        entity_type: "organization",
        entity_name: "Sierra AI",
      }),
    ];
    const contradictions = findContradictions(mems);
    expect(contradictions).toHaveLength(0);
  });

  it("should still check for contradictions when one memory has no entity_name", () => {
    const mems = [
      makeMemRow({
        id: "aaa",
        content: "James prefers using TypeScript for backend development projects",
        domain: "tech",
        entity_type: "person",
        entity_name: "James",
      }),
      makeMemRow({
        id: "bbb",
        content: "Prefers using Python for backend machine learning projects",
        domain: "tech",
        entity_type: null,
        entity_name: null,
      }),
    ];
    const contradictions = findContradictions(mems);
    expect(contradictions).toHaveLength(1);
  });
});
