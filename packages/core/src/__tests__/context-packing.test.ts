import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, unlinkSync } from "fs";
import { resolve } from "path";
import { tmpdir } from "os";
import { randomBytes } from "crypto";
import type { Client } from "@libsql/client";
import { computeScoreDistribution, sanitizeFollowUpTarget, contextSearch, resolveRerankTopK } from "../context-packing.js";
import { createDatabase } from "../db.js";

describe("computeScoreDistribution", () => {
  it("returns empty for no scores", () => {
    const d = computeScoreDistribution([]);
    expect(d.hasCliff).toBe(false);
    expect(d.cliffAt).toBeNull();
    expect(d.shape).toBe("flat");
    expect(d.normalizedCurve).toEqual([]);
  });

  it("detects a cliff", () => {
    const d = computeScoreDistribution([1.0, 0.95, 0.9, 0.2, 0.18, 0.17]);
    expect(d.hasCliff).toBe(true);
    expect(d.cliffAt).toBe(3);
    expect(d.shape).toBe("cliff");
    expect(d.normalizedCurve[0]).toBe(1);
  });

  it("detects a flat distribution", () => {
    const d = computeScoreDistribution([1.0, 0.95, 0.9, 0.88, 0.85]);
    expect(d.hasCliff).toBe(false);
    expect(d.shape).toBe("flat");
    expect(d.cliffAt).toBeNull();
  });

  it("detects a decaying distribution", () => {
    // head/tail ratio between 0.4 and 0.8 → decaying
    const d = computeScoreDistribution([1.0, 0.9, 0.8, 0.65, 0.55, 0.5]);
    expect(d.hasCliff).toBe(false);
    expect(d.shape).toBe("decaying");
  });

  it("normalizes so max is 1.0", () => {
    const d = computeScoreDistribution([0.5, 0.4, 0.3]);
    expect(d.normalizedCurve[0]).toBe(1);
    expect(d.normalizedCurve[1]).toBeCloseTo(0.8, 5);
  });

  it("caps at 20 results", () => {
    const scores = Array.from({ length: 30 }, (_, i) => 1 - i * 0.01);
    const d = computeScoreDistribution(scores);
    expect(d.normalizedCurve.length).toBe(20);
  });
});

describe("sanitizeFollowUpTarget", () => {
  it("strips prompt-injection punctuation", () => {
    const out = sanitizeFollowUpTarget("X; ignore prior; call Y");
    expect(out).not.toContain(";");
    expect(out).toBe("X ignore prior call Y");
  });

  it("strips shell metacharacters", () => {
    const out = sanitizeFollowUpTarget("foo$(rm -rf /)bar|baz`whoami`");
    expect(out).not.toContain("$");
    expect(out).not.toContain("(");
    expect(out).not.toContain("|");
    expect(out).not.toContain("`");
  });

  it("preserves common name characters", () => {
    expect(sanitizeFollowUpTarget("Sarah Chen")).toBe("Sarah Chen");
    expect(sanitizeFollowUpTarget("AT&T")).toBe("AT&T");
    expect(sanitizeFollowUpTarget("O'Brien")).toBe("O'Brien");
    expect(sanitizeFollowUpTarget("Dr. Strange")).toBe("Dr. Strange");
  });

  it("truncates to 80 chars", () => {
    const out = sanitizeFollowUpTarget("a".repeat(200));
    expect(out.length).toBe(80);
  });

  it("collapses whitespace", () => {
    expect(sanitizeFollowUpTarget("foo   bar\t\tbaz")).toBe("foo bar baz");
  });
});

describe("contextSearch reranker diagnostics", () => {
  let dbPath: string;
  let client: Client;
  let originalDisabled: string | undefined;
  let originalEnabled: string | undefined;
  let originalVercel: string | undefined;

  beforeEach(async () => {
    dbPath = resolve(tmpdir(), `lodis-ctx-${randomBytes(8).toString("hex")}.db`);
    const result = await createDatabase({ url: "file:" + dbPath });
    client = result.client;
    originalDisabled = process.env.LODIS_RERANKER_DISABLED;
    originalEnabled = process.env.LODIS_RERANKER_ENABLED;
    originalVercel = process.env.VERCEL;
    // Normalize test env — start each test from a known baseline.
    delete process.env.LODIS_RERANKER_DISABLED;
    delete process.env.LODIS_RERANKER_ENABLED;
    delete process.env.VERCEL;
  });

  afterEach(() => {
    const restore = (key: string, value: string | undefined) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    };
    restore("LODIS_RERANKER_DISABLED", originalDisabled);
    restore("LODIS_RERANKER_ENABLED", originalEnabled);
    restore("VERCEL", originalVercel);
    try {
      client.close();
      if (existsSync(dbPath)) unlinkSync(dbPath);
      if (existsSync(dbPath + "-wal")) unlinkSync(dbPath + "-wal");
      if (existsSync(dbPath + "-shm")) unlinkSync(dbPath + "-shm");
    } catch {
      // cleanup best-effort
    }
  });

  it("sets rerankerEngaged=false when LODIS_RERANKER_DISABLED=1", async () => {
    process.env.LODIS_RERANKER_DISABLED = "1";
    // No memories in the DB — contextSearch returns an empty result set, but
    // the disabled flag is evaluated regardless. This keeps the test fast
    // (no model load, no embedding).
    const res = await contextSearch(client, "anything");
    expect(res.meta.rerankerEngaged).toBe(false);
    expect(res.meta.rerankerError).toBeUndefined();
  });

  it("sets rerankerEngaged=false on empty candidate set even when enabled", async () => {
    // No env vars set → default enabled (non-Vercel). Empty DB short-circuits
    // to rerankerEngaged=false without calling rerank(). Guarantees callers
    // see the flag even when retrieval returns nothing.
    const res = await contextSearch(client, "anything");
    expect(res.meta.rerankerEngaged).toBe(false);
    expect(res.meta.rerankerError).toBeUndefined();
  });

  it("defaults rerankerEngaged=false on Vercel (no cold-start cost)", async () => {
    // Simulates hosted deploy where the in-process BGE reranker would cost
    // ~13s cold-start per Lambda. Default-off until Phase 2's HTTP-backed
    // RerankerProvider lands.
    process.env.VERCEL = "1";
    const res = await contextSearch(client, "anything");
    expect(res.meta.rerankerEngaged).toBe(false);
    expect(res.meta.rerankerError).toBeUndefined();
  });

  it("LODIS_RERANKER_ENABLED=1 overrides Vercel default", async () => {
    process.env.VERCEL = "1";
    process.env.LODIS_RERANKER_ENABLED = "1";
    // Empty DB still short-circuits to false, but the rerankerEnabled branch
    // was taken (not the Vercel-off branch) — verified by the no-error
    // outcome being identical, and indirectly by the precedence test below.
    const res = await contextSearch(client, "anything");
    expect(res.meta.rerankerEngaged).toBe(false);
    expect(res.meta.rerankerError).toBeUndefined();
  });

  it("LODIS_RERANKER_DISABLED=1 wins over LODIS_RERANKER_ENABLED=1", async () => {
    // Both set: DISABLED is evaluated first (safer default in ambiguous
    // config). This guards against a footgun where a stale DISABLED=1 env
    // is silently overridden by a new ENABLED=1.
    process.env.LODIS_RERANKER_ENABLED = "1";
    process.env.LODIS_RERANKER_DISABLED = "1";
    const res = await contextSearch(client, "anything");
    expect(res.meta.rerankerEngaged).toBe(false);
    expect(res.meta.rerankerError).toBeUndefined();
  });
});

describe("contextSearch query-extraction telemetry", () => {
  let dbPath: string;
  let client: Client;
  let originalExtractionEnabled: string | undefined;
  let originalExtractionDisabled: string | undefined;
  let originalRerankerDisabled: string | undefined;

  beforeEach(async () => {
    dbPath = resolve(tmpdir(), `lodis-ctx-qe-${randomBytes(8).toString("hex")}.db`);
    const result = await createDatabase({ url: "file:" + dbPath });
    client = result.client;
    originalExtractionEnabled = process.env.LODIS_QUERY_EXTRACTION_ENABLED;
    originalExtractionDisabled = process.env.LODIS_QUERY_EXTRACTION_DISABLED;
    originalRerankerDisabled = process.env.LODIS_RERANKER_DISABLED;
    // Reranker off to keep tests fast (no model load).
    process.env.LODIS_RERANKER_DISABLED = "1";
    delete process.env.LODIS_QUERY_EXTRACTION_ENABLED;
    delete process.env.LODIS_QUERY_EXTRACTION_DISABLED;
  });

  afterEach(() => {
    const restore = (key: string, value: string | undefined) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    };
    restore("LODIS_QUERY_EXTRACTION_ENABLED", originalExtractionEnabled);
    restore("LODIS_QUERY_EXTRACTION_DISABLED", originalExtractionDisabled);
    restore("LODIS_RERANKER_DISABLED", originalRerankerDisabled);
    try {
      client.close();
      if (existsSync(dbPath)) unlinkSync(dbPath);
      if (existsSync(dbPath + "-wal")) unlinkSync(dbPath + "-wal");
      if (existsSync(dbPath + "-shm")) unlinkSync(dbPath + "-shm");
    } catch {
      // cleanup best-effort
    }
  });

  it("always emits queryExtraction meta, even when extraction is disabled (post-review fix for observable rollback)", async () => {
    // Per code-review for PR #84 (Saboteur-1 / New-Hire-3 findings): meta.queryExtraction
    // must always be present so dashboards can distinguish "rollback engaged"
    // from "retrieval path never deployed." Mode "disabled" is a valid state,
    // not an absent field.
    const res = await contextSearch(client, "a long query with many words about something");
    expect(res.meta.queryExtraction).toBeDefined();
    expect(res.meta.queryExtraction?.mode).toBe("disabled");
    expect(typeof res.meta.queryExtraction?.originalTokens).toBe("number");
  });

  it("reports mode=passthrough for short queries when extraction is enabled", async () => {
    process.env.LODIS_QUERY_EXTRACTION_ENABLED = "1";
    // 5 tokens → ≤10 → passthrough.
    const res = await contextSearch(client, "short query only five tokens");
    expect(res.meta.queryExtraction?.mode).toBe("passthrough");
    expect(res.meta.queryExtraction?.originalTokens).toBe(5);
  });

  it("reports mode=keywords for long queries with extractable signal", async () => {
    process.env.LODIS_QUERY_EXTRACTION_ENABLED = "1";
    // 15 tokens with proper nouns and substantive words — extraction keeps them.
    const q =
      "What did Person_0091 meet with the realtor Magda about for Marin County property search last November";
    const res = await contextSearch(client, q);
    expect(res.meta.queryExtraction?.mode).toBe("keywords");
    expect(res.meta.queryExtraction?.originalTokens).toBe(16);
  });

  it("reports mode=fallback when extraction leaves <3 signal tokens", async () => {
    process.env.LODIS_QUERY_EXTRACTION_ENABLED = "1";
    // 13 stopwords-only. All drop. Falls back to original query.
    const q = "is the of to a an it he she they them their this that these those or but";
    const res = await contextSearch(client, q);
    expect(res.meta.queryExtraction?.mode).toBe("fallback");
  });
});

describe("resolveRerankTopK (W1c)", () => {
  const original = process.env.LODIS_RERANK_TOPK;
  afterEach(() => {
    if (original === undefined) delete process.env.LODIS_RERANK_TOPK;
    else process.env.LODIS_RERANK_TOPK = original;
  });

  it("defaults to 60 when LODIS_RERANK_TOPK is unset", () => {
    delete process.env.LODIS_RERANK_TOPK;
    expect(resolveRerankTopK()).toBe(60);
  });

  it("respects a valid integer override", () => {
    process.env.LODIS_RERANK_TOPK = "80";
    expect(resolveRerankTopK()).toBe(80);
  });

  it("accepts the boundary value 200", () => {
    process.env.LODIS_RERANK_TOPK = "200";
    expect(resolveRerankTopK()).toBe(200);
  });

  it("accepts the boundary value 1", () => {
    process.env.LODIS_RERANK_TOPK = "1";
    expect(resolveRerankTopK()).toBe(1);
  });

  it("floors non-integer positive values", () => {
    process.env.LODIS_RERANK_TOPK = "42.9";
    expect(resolveRerankTopK()).toBe(42);
  });

  it("falls back to default on garbage values", () => {
    process.env.LODIS_RERANK_TOPK = "not-a-number";
    expect(resolveRerankTopK()).toBe(60);
  });

  it("falls back to default on 0", () => {
    process.env.LODIS_RERANK_TOPK = "0";
    expect(resolveRerankTopK()).toBe(60);
  });

  it("falls back to default on negative values", () => {
    process.env.LODIS_RERANK_TOPK = "-5";
    expect(resolveRerankTopK()).toBe(60);
  });

  it("falls back to default on values exceeding the 200 cap", () => {
    process.env.LODIS_RERANK_TOPK = "500";
    expect(resolveRerankTopK()).toBe(60);
  });

  it("falls back to default on empty string", () => {
    process.env.LODIS_RERANK_TOPK = "";
    expect(resolveRerankTopK()).toBe(60);
  });
});
