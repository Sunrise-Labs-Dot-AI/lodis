import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, unlinkSync } from "fs";
import { resolve } from "path";
import { tmpdir } from "os";
import { randomBytes } from "crypto";
import { createDatabase } from "../db.js";
import { applyConfidenceDecay, DECAY_RATE, UNUSED_DECAY_RATE, MIN_CONFIDENCE } from "../confidence.js";
import type { Client } from "@libsql/client";

function tempDbPath(): string {
  return resolve(tmpdir(), `engrams-test-${randomBytes(8).toString("hex")}.db`);
}

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

async function insertMemory(
  client: Client,
  id: string,
  confidence: number,
  learnedAt: string,
  opts: {
    lastUsedAt?: string | null;
    confirmedAt?: string | null;
    usedCount?: number;
    confirmedCount?: number;
  } = {},
) {
  await client.execute({
    sql: `INSERT INTO memories (id, content, domain, source_agent_id, source_agent_name, source_type, confidence, learned_at, last_used_at, confirmed_at, used_count, confirmed_count)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id, `Memory ${id}`, "general", "agent1", "test", "stated",
      confidence, learnedAt,
      opts.lastUsedAt ?? null,
      opts.confirmedAt ?? null,
      opts.usedCount ?? 0,
      opts.confirmedCount ?? 0,
    ],
  });
}

describe("applyConfidenceDecay", () => {
  let dbPath: string;
  let client: Client;

  beforeEach(async () => {
    dbPath = tempDbPath();
    const result = await createDatabase({ url: "file:" + dbPath });
    client = result.client;
  });

  afterEach(() => {
    try {
      client.close();
      if (existsSync(dbPath)) unlinkSync(dbPath);
      if (existsSync(dbPath + "-wal")) unlinkSync(dbPath + "-wal");
      if (existsSync(dbPath + "-shm")) unlinkSync(dbPath + "-shm");
    } catch {
      // cleanup best-effort
    }
  });

  it("decays unused memory at faster rate after 30 days", async () => {
    await insertMemory(client, "m1", 0.9, daysAgo(35));
    const decayed = await applyConfidenceDecay(client);
    expect(decayed).toBe(1);

    const result = await client.execute({ sql: `SELECT confidence FROM memories WHERE id = 'm1'`, args: [] });
    expect(result.rows[0].confidence as number).toBeCloseTo(0.9 - UNUSED_DECAY_RATE);
  });

  it("decays used memory at standard rate after 30 days", async () => {
    await insertMemory(client, "m1", 0.9, daysAgo(35), { usedCount: 3 });
    const decayed = await applyConfidenceDecay(client);
    expect(decayed).toBe(1);

    const result = await client.execute({ sql: `SELECT confidence FROM memories WHERE id = 'm1'`, args: [] });
    expect(result.rows[0].confidence as number).toBeCloseTo(0.9 - DECAY_RATE);
  });

  it("decays confirmed memory at standard rate", async () => {
    await insertMemory(client, "m1", 0.9, daysAgo(65), { confirmedCount: 1 });
    await applyConfidenceDecay(client);

    const result = await client.execute({ sql: `SELECT confidence FROM memories WHERE id = 'm1'`, args: [] });
    expect(result.rows[0].confidence as number).toBeCloseTo(0.9 - DECAY_RATE * 2);
  });

  it("unused memory decays significantly over 60 days", async () => {
    await insertMemory(client, "m1", 0.9, daysAgo(65));
    await applyConfidenceDecay(client);

    const result = await client.execute({ sql: `SELECT confidence FROM memories WHERE id = 'm1'`, args: [] });
    // 2 periods * 0.05 = 0.10 decay
    expect(result.rows[0].confidence as number).toBeCloseTo(0.9 - UNUSED_DECAY_RATE * 2);
  });

  it("does not decay within 30 days", async () => {
    await insertMemory(client, "m1", 0.9, daysAgo(15));
    const decayed = await applyConfidenceDecay(client);
    expect(decayed).toBe(0);

    const result = await client.execute({ sql: `SELECT confidence FROM memories WHERE id = 'm1'`, args: [] });
    expect(result.rows[0].confidence).toBe(0.9);
  });

  it("does not go below MIN_CONFIDENCE", async () => {
    await insertMemory(client, "m1", 0.12, daysAgo(365));
    await applyConfidenceDecay(client);

    const result = await client.execute({ sql: `SELECT confidence FROM memories WHERE id = 'm1'`, args: [] });
    expect(result.rows[0].confidence).toBe(MIN_CONFIDENCE);
  });

  it("skips memories already at MIN_CONFIDENCE", async () => {
    await insertMemory(client, "m1", MIN_CONFIDENCE, daysAgo(365));
    const decayed = await applyConfidenceDecay(client);
    expect(decayed).toBe(0);
  });

  it("does not decay recently used memories", async () => {
    await insertMemory(client, "m1", 0.9, daysAgo(90), { lastUsedAt: daysAgo(5), usedCount: 1 });
    const decayed = await applyConfidenceDecay(client);
    expect(decayed).toBe(0);
  });

  it("does not decay recently confirmed memories", async () => {
    await insertMemory(client, "m1", 0.9, daysAgo(90), { confirmedAt: daysAgo(10), confirmedCount: 1 });
    const decayed = await applyConfidenceDecay(client);
    expect(decayed).toBe(0);
  });

  it("uses most recent activity timestamp", async () => {
    await insertMemory(client, "m1", 0.9, daysAgo(90), { confirmedAt: daysAgo(5), confirmedCount: 1 });
    const decayed = await applyConfidenceDecay(client);
    expect(decayed).toBe(0);
  });

  it("unused memory reaches low confidence in ~6 months", async () => {
    // 180 days = 6 periods, 6 * 0.05 = 0.30 decay
    await insertMemory(client, "m1", 0.9, daysAgo(180));
    await applyConfidenceDecay(client);

    const result = await client.execute({ sql: `SELECT confidence FROM memories WHERE id = 'm1'`, args: [] });
    const conf = result.rows[0].confidence as number;
    expect(conf).toBeCloseTo(0.9 - UNUSED_DECAY_RATE * 6); // 0.60
    expect(conf).toBeLessThan(0.65);
  });
});
