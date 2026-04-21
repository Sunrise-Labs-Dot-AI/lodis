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
