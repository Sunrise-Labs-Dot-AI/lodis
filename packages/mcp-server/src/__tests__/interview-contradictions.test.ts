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
  corrected_count: number;
  mistake_count: number;
  used_count: number;
  permanence: string | null;
  expires_at: string | null;
  has_pii_flag: number;
  structured_data: string | null;
  confirmed_at: string | null;
  updated_at: string | null;
  last_used_at: string | null;
  source_type: string | null;
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

function extractClaim(content: string, entityName: string | null): string {
  let claim = content.toLowerCase();
  if (entityName) {
    claim = claim.replace(new RegExp(entityName.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), "");
  }
  claim = claim.replace(/^(i think|i believe|user said|user mentioned|note:|remember:)\s*/i, "");
  return claim.trim();
}

function hasNegationConflict(claimA: string, claimB: string): boolean {
  const negationPairs: [RegExp, RegExp][] = [
    [/\blikes?\b/, /\b(doesn't|does not|hates?|dislikes?)\b/],
    [/\bprefers?\b/, /\b(avoids?|doesn't prefer|does not prefer)\b/],
    [/\bis\b/, /\b(isn't|is not|is no longer|was formerly)\b/],
    [/\buses?\b/, /\b(doesn't use|stopped using|no longer uses)\b/],
    [/\bworks?\s+(at|for|with)\b/, /\b(left|no longer works|quit|resigned from)\b/],
    [/\bwants?\b/, /\b(doesn't want|does not want)\b/],
  ];
  for (const [pos, neg] of negationPairs) {
    if ((pos.test(claimA) && neg.test(claimB)) || (pos.test(claimB) && neg.test(claimA))) {
      return true;
    }
  }
  return false;
}

function hasConflictingValues(claimA: string, claimB: string): boolean {
  // Match proper nouns after key verbs/prepositions, allowing intermediate words
  // Only proper nouns (capitalized words), not bare numbers — numbers are too ambiguous
  const valuePattern = /\b(?:is|at|for|in|on|uses?|prefers?|using|as)\s+(?:\w+\s+)*?([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/g;
  const valsA: string[] = [];
  const valsB: string[] = [];
  let match;
  while ((match = valuePattern.exec(claimA)) !== null) valsA.push(match[1].toLowerCase());
  valuePattern.lastIndex = 0;
  while ((match = valuePattern.exec(claimB)) !== null) valsB.push(match[1].toLowerCase());
  if (valsA.length > 0 && valsB.length > 0) {
    for (const a of valsA) {
      for (const b of valsB) {
        if (a !== b && a.length > 2 && b.length > 2) return true;
      }
    }
  }
  return false;
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
    corrected_count: 0,
    mistake_count: 0,
    used_count: 0,
    permanence: "active",
    expires_at: null,
    has_pii_flag: 0,
    structured_data: null,
    confirmed_at: null,
    updated_at: null,
    last_used_at: null,
    source_type: null,
    ...overrides,
  };
}

/** Runs the multi-signal contradiction detection logic on an array of MemRows and returns flagged pairs. */
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
    const memData = domainMems.map(m => ({
      mem: m,
      words: wordSet(m.content + (m.detail ? " " + m.detail : ""), m.entity_name),
      claim: extractClaim(m.content + (m.detail ? " " + m.detail : ""), m.entity_name),
    }));

    for (let i = 0; i < memData.length; i++) {
      for (let j = i + 1; j < memData.length; j++) {
        const a = memData[i], b = memData[j];
        const key = [a.mem.id, b.mem.id].sort().join("|");
        if (seen.has(key)) continue;

        // Skip conditions
        if (a.mem.confirmed_at && b.mem.confirmed_at) continue;
        if (isDocumentIndex(a.mem) && isDocumentIndex(b.mem)) continue;
        if (a.mem.entity_name && b.mem.entity_name &&
            a.mem.entity_name.toLowerCase() !== b.mem.entity_name.toLowerCase()) continue;

        const overlap = wordOverlap(a.words, b.words);

        // Multi-signal conflict scoring
        let conflictScore = 0;

        // Signal 1: Word overlap in the contradiction range
        if (overlap >= 0.40 && overlap < 0.75) {
          conflictScore += 0.3;
        }

        // Signal 2: Same entity_type AND entity_name — higher conflict risk
        if (a.mem.entity_type && a.mem.entity_type === b.mem.entity_type &&
            a.mem.entity_name && b.mem.entity_name &&
            a.mem.entity_name.toLowerCase() === b.mem.entity_name.toLowerCase()) {
          conflictScore += 0.2;
        }

        // Signal 3: Negation language detected
        if (hasNegationConflict(a.claim, b.claim)) {
          conflictScore += 0.4;
        }

        // Signal 4: Conflicting specific values (use original content, not lowercased claims)
        const aText = a.mem.content + (a.mem.detail ? " " + a.mem.detail : "");
        const bText = b.mem.content + (b.mem.detail ? " " + b.mem.detail : "");
        if (hasConflictingValues(aText, bText)) {
          conflictScore += 0.3;
        }

        // Signal 5: Different entity_types = likely complementary, not conflicting
        if (a.mem.entity_type && b.mem.entity_type && a.mem.entity_type !== b.mem.entity_type) {
          conflictScore -= 0.3;
        }

        if (conflictScore >= 0.5) {
          seen.add(key);
          results.push([a.mem.id, b.mem.id]);
        }
      }
    }
  }
  return results;
}

describe("interview contradiction detection", () => {
  // Two memories with word overlap + conflicting values (TypeScript vs Python)
  const contentA = "James prefers using TypeScript for backend development projects";
  const contentB = "James prefers using Python for backend machine learning";

  it("should flag overlapping memories with conflicting values", () => {
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
    // Malformed JSON → isDocumentIndex returns false → should still flag
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

  // --- New multi-signal tests ---

  it("should flag memories with negation conflict even with moderate overlap", () => {
    const mems = [
      makeMemRow({
        id: "aaa",
        content: "James likes dark mode for all his editors and terminals",
        domain: "preferences",
      }),
      makeMemRow({
        id: "bbb",
        content: "James dislikes dark mode and prefers light themes for editors",
        domain: "preferences",
      }),
    ];
    const contradictions = findContradictions(mems);
    expect(contradictions).toHaveLength(1);
  });

  it("should NOT flag memories with word overlap but different entity types (complementary)", () => {
    const mems = [
      makeMemRow({
        id: "aaa",
        content: "Notion is used for project documentation and team wikis at the company",
        domain: "tools",
        entity_type: "resource",
        entity_name: "Notion",
      }),
      makeMemRow({
        id: "bbb",
        content: "The team prefers Notion for project planning and documentation workflows",
        domain: "tools",
        entity_type: "preference",
        entity_name: "Notion",
      }),
    ];
    // Same entity_name but different entity_types: overlap +0.3, same entity +0.2, different types -0.3 = 0.2 (below threshold)
    const contradictions = findContradictions(mems);
    expect(contradictions).toHaveLength(0);
  });

  it("should flag memories about same person with 'works at' vs 'left' conflict", () => {
    const mems = [
      makeMemRow({
        id: "aaa",
        content: "Alice works at Google on the Search team",
        domain: "people",
        entity_type: "person",
        entity_name: "Alice",
      }),
      makeMemRow({
        id: "bbb",
        content: "Alice left Google and joined OpenAI last month",
        domain: "people",
        entity_type: "person",
        entity_name: "Alice",
      }),
    ];
    const contradictions = findContradictions(mems);
    expect(contradictions).toHaveLength(1);
  });

  it("should NOT flag low-overlap memories even with same entity", () => {
    const mems = [
      makeMemRow({
        id: "aaa",
        content: "Bob enjoys hiking on weekends and mountain biking",
        domain: "people",
        entity_type: "person",
        entity_name: "Bob",
      }),
      makeMemRow({
        id: "bbb",
        content: "Bob is a senior engineer at Meta working on infrastructure",
        domain: "people",
        entity_type: "person",
        entity_name: "Bob",
      }),
    ];
    // Very low word overlap, same entity gives +0.2 but that's not enough
    const contradictions = findContradictions(mems);
    expect(contradictions).toHaveLength(0);
  });
});

describe("extractClaim", () => {
  it("should strip entity name from claim", () => {
    expect(extractClaim("Sarah Chen works at Google", "Sarah Chen")).toBe("works at google");
  });

  it("should strip framing words", () => {
    expect(extractClaim("I think dark mode is better", null)).toBe("dark mode is better");
    expect(extractClaim("User mentioned they like TypeScript", null)).toBe("they like typescript");
  });

  it("should handle null entity name", () => {
    expect(extractClaim("Prefers Python for ML", null)).toBe("prefers python for ml");
  });
});

describe("hasNegationConflict", () => {
  it("should detect likes/dislikes conflict", () => {
    expect(hasNegationConflict("james likes coffee", "james dislikes coffee")).toBe(true);
  });

  it("should detect is/is not conflict", () => {
    expect(hasNegationConflict("alice is a manager", "alice is not a manager")).toBe(true);
  });

  it("should detect works at/left conflict", () => {
    expect(hasNegationConflict("works at google on search", "left google last month")).toBe(true);
  });

  it("should return false for non-conflicting text", () => {
    expect(hasNegationConflict("likes coffee", "likes tea")).toBe(false);
  });

  it("should detect uses/stopped using conflict", () => {
    expect(hasNegationConflict("uses vim for editing", "stopped using vim")).toBe(true);
  });
});

describe("hasConflictingValues", () => {
  it("should detect different proper nouns in value slots", () => {
    expect(hasConflictingValues(
      "Sarah Chen works at Anthropic on the safety team",
      "Sarah Chen works at Google on the search team"
    )).toBe(true);
  });

  it("should detect different proper nouns after 'using'", () => {
    expect(hasConflictingValues(
      "James prefers using TypeScript for backend development",
      "James prefers using Python for backend development"
    )).toBe(true);
  });

  it("should return false when no value patterns match", () => {
    expect(hasConflictingValues("likes coffee", "enjoys tea")).toBe(false);
  });

  it("should NOT flag different numbers as conflicting (too ambiguous)", () => {
    expect(hasConflictingValues(
      "Sierra AI is a startup founded in 2023",
      "Sierra AI raised a Series B round in late 2024"
    )).toBe(false);
  });

  it("should return false when proper nouns match (same value)", () => {
    expect(hasConflictingValues(
      "works at Anthropic on safety",
      "employed at Anthropic in research"
    )).toBe(false);
  });
});
