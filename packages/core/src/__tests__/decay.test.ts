import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, unlinkSync } from "fs";
import { resolve } from "path";
import { tmpdir } from "os";
import { randomBytes } from "crypto";
import { createDatabase } from "../db.js";
import { applyConfidenceDecay, DECAY_RATE, MIN_CONFIDENCE, DECAY_INTERVAL_MS } from "../confidence.js";

function tempDbPath(): string {
  return resolve(tmpdir(), `engrams-test-${randomBytes(8).toString("hex")}.db`);
}

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function insertMemory(
  sqlite: ReturnType<typeof createDatabase>["sqlite"],
  id: string,
  confidence: number,
  learnedAt: string,
  lastUsedAt: string | null = null,
  confirmedAt: string | null = null,
) {
  sqlite
    .prepare(
      `INSERT INTO memories (id, content, domain, source_agent_id, source_agent_name, source_type, confidence, learned_at, last_used_at, confirmed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, `Memory ${id}`, "general", "agent1", "test", "stated", confidence, learnedAt, lastUsedAt, confirmedAt);
}

describe("applyConfidenceDecay", () => {
  let dbPath: string;
  let sqlite: ReturnType<typeof createDatabase>["sqlite"];

  beforeEach(() => {
    dbPath = tempDbPath();
    const result = createDatabase(dbPath);
    sqlite = result.sqlite;
  });

  afterEach(() => {
    try {
      sqlite.close();
      if (existsSync(dbPath)) unlinkSync(dbPath);
      if (existsSync(dbPath + "-wal")) unlinkSync(dbPath + "-wal");
      if (existsSync(dbPath + "-shm")) unlinkSync(dbPath + "-shm");
    } catch {
      // cleanup best-effort
    }
  });

  it("decays memory after 30 days of inactivity", () => {
    insertMemory(sqlite, "m1", 0.9, daysAgo(35));
    const decayed = applyConfidenceDecay(sqlite);
    expect(decayed).toBe(1);

    const row = sqlite.prepare(`SELECT confidence FROM memories WHERE id = 'm1'`).get() as { confidence: number };
    expect(row.confidence).toBeCloseTo(0.9 - DECAY_RATE);
  });

  it("applies 2x decay for 60 days of inactivity", () => {
    insertMemory(sqlite, "m1", 0.9, daysAgo(65));
    applyConfidenceDecay(sqlite);

    const row = sqlite.prepare(`SELECT confidence FROM memories WHERE id = 'm1'`).get() as { confidence: number };
    expect(row.confidence).toBeCloseTo(0.9 - DECAY_RATE * 2);
  });

  it("does not decay within 30 days", () => {
    insertMemory(sqlite, "m1", 0.9, daysAgo(15));
    const decayed = applyConfidenceDecay(sqlite);
    expect(decayed).toBe(0);

    const row = sqlite.prepare(`SELECT confidence FROM memories WHERE id = 'm1'`).get() as { confidence: number };
    expect(row.confidence).toBe(0.9);
  });

  it("does not go below MIN_CONFIDENCE", () => {
    insertMemory(sqlite, "m1", 0.12, daysAgo(365));
    applyConfidenceDecay(sqlite);

    const row = sqlite.prepare(`SELECT confidence FROM memories WHERE id = 'm1'`).get() as { confidence: number };
    expect(row.confidence).toBe(MIN_CONFIDENCE);
  });

  it("skips memories already at MIN_CONFIDENCE", () => {
    insertMemory(sqlite, "m1", MIN_CONFIDENCE, daysAgo(365));
    const decayed = applyConfidenceDecay(sqlite);
    expect(decayed).toBe(0);
  });

  it("does not decay recently used memories", () => {
    insertMemory(sqlite, "m1", 0.9, daysAgo(90), daysAgo(5));
    const decayed = applyConfidenceDecay(sqlite);
    expect(decayed).toBe(0);
  });

  it("does not decay recently confirmed memories", () => {
    insertMemory(sqlite, "m1", 0.9, daysAgo(90), null, daysAgo(10));
    const decayed = applyConfidenceDecay(sqlite);
    expect(decayed).toBe(0);
  });

  it("uses most recent activity timestamp", () => {
    // learned 90 days ago but confirmed 5 days ago — should not decay
    insertMemory(sqlite, "m1", 0.9, daysAgo(90), null, daysAgo(5));
    const decayed = applyConfidenceDecay(sqlite);
    expect(decayed).toBe(0);
  });
});
