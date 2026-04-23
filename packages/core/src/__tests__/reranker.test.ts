import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  rerank,
  getReranker,
  DEFAULT_RERANKER_MODEL,
  HttpReranker,
  LocalReranker,
  selectRerankerProvider,
} from "../reranker.js";

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

describe("HttpReranker", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("posts query + candidates to the configured endpoint", async () => {
    const fetchSpy = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response(
          JSON.stringify({
            results: [
              { id: "A", score: 8.5, rank: 1 },
              { id: "B", score: -2.1, rank: 2 },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    globalThis.fetch = fetchSpy;
    const reranker = new HttpReranker("https://rerank.example.com", "test-key");

    const results = await reranker.rerank("query", [
      { id: "A", text: "candidate A text" },
      { id: "B", text: "candidate B text" },
    ]);

    expect(fetchSpy).toHaveBeenCalledOnce();
    const call = fetchSpy.mock.calls[0];
    const url = call[0] as string;
    const init = call[1] as RequestInit;
    expect(url).toBe("https://rerank.example.com");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers["content-type"]).toBe("application/json");
    expect(headers["authorization"]).toBe("Bearer test-key");
    const body = JSON.parse(init.body as string);
    expect(body.query).toBe("query");
    expect(body.candidates).toHaveLength(2);
    expect(results[0].id).toBe("A");
    expect(results[0].rank).toBe(1);
    expect(results[1].rank).toBe(2);
  });

  it("omits authorization header when no apiKey provided", async () => {
    const fetchSpy = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response(JSON.stringify({ results: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    globalThis.fetch = fetchSpy;
    const reranker = new HttpReranker("https://rerank.example.com");
    await reranker.rerank("q", [{ id: "A", text: "t" }]);
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers["authorization"]).toBeUndefined();
  });

  it("throws with status + body on non-2xx", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response("service unavailable", { status: 503 }),
    ) as unknown as typeof globalThis.fetch;
    const reranker = new HttpReranker("https://rerank.example.com");
    await expect(reranker.rerank("q", [{ id: "A", text: "t" }])).rejects.toThrow(/503/);
  });

  it("throws on malformed response missing results array", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ not_results: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ) as unknown as typeof globalThis.fetch;
    const reranker = new HttpReranker("https://rerank.example.com");
    await expect(reranker.rerank("q", [{ id: "A", text: "t" }])).rejects.toThrow(/malformed/);
  });

  it("short-circuits on empty candidates without making a request", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch;
    const reranker = new HttpReranker("https://rerank.example.com");
    const results = await reranker.rerank("q", []);
    expect(results).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("respects topK by slicing the response", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          results: [
            { id: "A", score: 10, rank: 1 },
            { id: "B", score: 5, rank: 2 },
            { id: "C", score: 1, rank: 3 },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    ) as unknown as typeof globalThis.fetch;
    const reranker = new HttpReranker("https://rerank.example.com");
    const results = await reranker.rerank(
      "q",
      [
        { id: "A", text: "a" },
        { id: "B", text: "b" },
        { id: "C", text: "c" },
      ],
      { topK: 2 },
    );
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.id)).toEqual(["A", "B"]);
  });

  it("re-sorts server response defensively (guards against server-side bugs)", async () => {
    // Some server impls forget to sort; we defensive-sort + re-rank.
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          results: [
            { id: "low", score: 1, rank: 1 },
            { id: "high", score: 10, rank: 2 },
            { id: "mid", score: 5, rank: 3 },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    ) as unknown as typeof globalThis.fetch;
    const reranker = new HttpReranker("https://rerank.example.com");
    const results = await reranker.rerank("q", [
      { id: "low", text: "x" },
      { id: "high", text: "y" },
      { id: "mid", text: "z" },
    ]);
    expect(results.map((r) => r.id)).toEqual(["high", "mid", "low"]);
    expect(results.map((r) => r.rank)).toEqual([1, 2, 3]);
  });
});

describe("selectRerankerProvider", () => {
  const originalUrl = process.env.LODIS_RERANKER_URL;
  const originalKey = process.env.LODIS_RERANKER_API_KEY;
  const originalModel = process.env.LODIS_RERANKER_MODEL;
  beforeEach(() => {
    delete process.env.LODIS_RERANKER_URL;
    delete process.env.LODIS_RERANKER_API_KEY;
    delete process.env.LODIS_RERANKER_MODEL;
  });
  afterEach(() => {
    const restore = (key: string, value: string | undefined) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    };
    restore("LODIS_RERANKER_URL", originalUrl);
    restore("LODIS_RERANKER_API_KEY", originalKey);
    restore("LODIS_RERANKER_MODEL", originalModel);
  });

  it("returns HttpReranker when LODIS_RERANKER_URL is set", () => {
    process.env.LODIS_RERANKER_URL = "https://rerank.example.com";
    process.env.LODIS_RERANKER_API_KEY = "k";
    const provider = selectRerankerProvider();
    expect(provider).toBeInstanceOf(HttpReranker);
  });

  it("returns LocalReranker when no URL is set", () => {
    const provider = selectRerankerProvider();
    expect(provider).toBeInstanceOf(LocalReranker);
  });
});
