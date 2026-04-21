import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, unlinkSync } from "fs";
import { resolve } from "path";
import { tmpdir } from "os";
import { randomBytes } from "crypto";
import type { Client } from "@libsql/client";
import { computeScoreDistribution, sanitizeFollowUpTarget, contextSearch } from "../context-packing.js";
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

  beforeEach(async () => {
    dbPath = resolve(tmpdir(), `lodis-ctx-${randomBytes(8).toString("hex")}.db`);
    const result = await createDatabase({ url: "file:" + dbPath });
    client = result.client;
    originalDisabled = process.env.LODIS_RERANKER_DISABLED;
  });

  afterEach(() => {
    if (originalDisabled === undefined) delete process.env.LODIS_RERANKER_DISABLED;
    else process.env.LODIS_RERANKER_DISABLED = originalDisabled;
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
    delete process.env.LODIS_RERANKER_DISABLED;
    const res = await contextSearch(client, "anything");
    // results.length === 0 short-circuits before rerank() is called, and we
    // still report the flag so dashboards don't see `undefined` for empty
    // queries.
    expect(res.meta.rerankerEngaged).toBe(false);
    expect(res.meta.rerankerError).toBeUndefined();
  });
});
