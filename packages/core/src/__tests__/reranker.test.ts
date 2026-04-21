import { describe, it, expect } from "vitest";
import { rerank, getReranker, DEFAULT_RERANKER_MODEL } from "../reranker.js";

// These tests exercise the real @huggingface/transformers runtime and load
// the BGE reranker model (~80 MB download on first run, cached in ~/.lodis/
// models afterward). They are slow but ensure the reranker actually scores
// candidates sensibly end-to-end.

describe("reranker", () => {
  it("returns empty array for empty candidates without loading model", async () => {
    const result = await rerank("any query", []);
    expect(result).toEqual([]);
  });

  it("reorders candidates by query relevance", async () => {
    const query = "What airport did James fly out of for his SoCal trip?";
    const candidates = [
      {
        id: "A",
        text: "James took a trip to SoCal: flew SFO to Orange County on March 29, returned April 3.",
      },
      { id: "B", text: "James prefers dark mode in all editors." },
      { id: "C", text: "The Anthropic interview is scheduled for Tuesday." },
    ];
    const results = await rerank(query, candidates);
    expect(results).toHaveLength(3);
    // A is the only candidate that mentions an airport and a SoCal flight.
    expect(results[0].id).toBe("A");
    // A's score should be clearly higher than B/C (unrelated).
    expect(results[0].score).toBeGreaterThan(results[1].score);
    expect(results[1].score).toBeGreaterThan(results[2].score - 0.01); // allow tie
    // Ranks are 1-indexed in descending score order.
    expect(results[0].rank).toBe(1);
    expect(results[1].rank).toBe(2);
    expect(results[2].rank).toBe(3);
  }, 60_000);

  it("produces a realistic score spread — guards against silent no-op", async () => {
    // Regression guard: if rerank() "succeeds" but silently returns uniform
    // scores (e.g. broken tokenizer + fallback RRF-like ordering), ordering
    // tests alone can still pass. BGE-reranker-base separates a clearly
    // relevant document from a clearly irrelevant one by >1 logit point in
    // practice. This test fails fast if the model isn't actually scoring.
    const query = "Who is the recruiter at Anthropic for the PM Consumer role?";
    const candidates = [
      { id: "relevant", text: "Laura Small: Recruiter at Anthropic for the PM Consumer role. First screen on 3/14." },
      { id: "irrelevant1", text: "James has five siblings, including twin brother Alex." },
      { id: "irrelevant2", text: "Karen and John Stine married on 9/24/1977 in Boulder." },
      { id: "irrelevant3", text: "Weston attends preschool and Copper is the family dog." },
      { id: "irrelevant4", text: "Anniversary list: JB/Natalie 7/23/2011, Chelsea/Evan 5/12/2012." },
    ];
    const results = await rerank(query, candidates);
    expect(results[0].id).toBe("relevant");
    // Score spread between best and worst must exceed 0.5 logits — BGE
    // routinely produces >3 logit spread on this contrast. 0.5 is a loose
    // floor that a legitimately-running reranker always clears.
    const spread = results[0].score - results[results.length - 1].score;
    expect(spread).toBeGreaterThan(0.5);
  }, 60_000);

  it("truncates to topK when provided", async () => {
    const candidates = Array.from({ length: 10 }, (_, i) => ({
      id: `c${i}`,
      text: `Candidate document number ${i} with varying relevance.`,
    }));
    const results = await rerank("relevant query", candidates, { topK: 3 });
    expect(results).toHaveLength(3);
  }, 60_000);

  it("getReranker is idempotent for the default model", async () => {
    const r1 = await getReranker();
    const r2 = await getReranker();
    expect(r1).toBe(r2);
    expect(r1.modelId).toBe(DEFAULT_RERANKER_MODEL);
  }, 60_000);
});
