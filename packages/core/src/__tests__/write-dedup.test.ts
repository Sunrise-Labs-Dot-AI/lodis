import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, unlinkSync } from "fs";
import { resolve } from "path";
import { tmpdir } from "os";
import { randomBytes } from "crypto";
import { createDatabase, bumpLastModified } from "../db.js";
import { searchFTS } from "../fts.js";
import type { Client } from "@libsql/client";

function tempDbPath(): string {
  return resolve(tmpdir(), `engrams-dedup-${randomBytes(8).toString("hex")}.db`);
}

function generateId(): string {
  return randomBytes(16).toString("hex");
}

function now(): string {
  return new Date().toISOString();
}

async function insertMemory(
  client: Client,
  overrides: Partial<{
    id: string;
    content: string;
    detail: string | null;
    domain: string;
    confidence: number;
    correctedCount: number;
  }> = {},
) {
  const id = overrides.id ?? generateId();
  await client.execute({
    sql: `INSERT INTO memories (id, content, detail, domain, source_agent_id, source_agent_name, source_type, confidence, corrected_count, learned_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      overrides.content ?? "Test memory",
      overrides.detail ?? null,
      overrides.domain ?? "general",
      "agent1",
      "claude",
      "stated",
      overrides.confidence ?? 0.9,
      overrides.correctedCount ?? 0,
      now(),
    ],
  });
  return id;
}

async function getMemory(client: Client, id: string) {
  const result = await client.execute({
    sql: `SELECT * FROM memories WHERE id = ? AND deleted_at IS NULL`,
    args: [id],
  });
  return result.rows[0] as Record<string, unknown> | undefined;
}

describe("write dedup resolution", () => {
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

  it("inserts new memory when no similar exists", async () => {
    const id = await insertMemory(client, { content: "User prefers dark mode" });
    const mem = await getMemory(client, id);
    expect(mem).toBeDefined();
    expect(mem!.content).toBe("User prefers dark mode");
  });

  it("resolution: update — replaces content and bumps confidence", async () => {
    const existingId = await insertMemory(client, {
      content: "User likes Python",
      confidence: 0.85,
    });

    // Simulate "update" resolution
    const newContent = "User prefers Python for data science";
    const newDetail = "Mentioned during a project discussion";
    const existingMem = (await getMemory(client, existingId))!;
    const oldConfidence = existingMem.confidence as number;
    const newConfidence = Math.min(oldConfidence + 0.02, 0.99);

    await client.execute({
      sql: `UPDATE memories SET content = ?, detail = ?, confidence = ? WHERE id = ?`,
      args: [newContent, newDetail, newConfidence, existingId],
    });

    const updated = (await getMemory(client, existingId))!;
    expect(updated.content).toBe(newContent);
    expect(updated.detail).toBe(newDetail);
    expect(updated.confidence as number).toBeCloseTo(0.87, 2);
  });

  it("resolution: correct — updates content and boosts confidence to min(max(existing, 0.85), 0.99)", async () => {
    // Low confidence memory
    const existingId = await insertMemory(client, {
      content: "User uses Java",
      confidence: 0.50,
    });

    const newContent = "User uses TypeScript";
    const existingMem = (await getMemory(client, existingId))!;
    const oldConfidence = existingMem.confidence as number;
    const newConfidence = Math.min(Math.max(oldConfidence, 0.85), 0.99);
    const oldCorrectedCount = (existingMem.corrected_count as number) ?? 0;

    await client.execute({
      sql: `UPDATE memories SET content = ?, confidence = ?, corrected_count = ? WHERE id = ?`,
      args: [newContent, newConfidence, oldCorrectedCount + 1, existingId],
    });

    const corrected = (await getMemory(client, existingId))!;
    expect(corrected.content).toBe(newContent);
    expect(corrected.confidence).toBe(0.85); // max(0.50, 0.85)
    expect(corrected.corrected_count).toBe(1);
  });

  it("resolution: correct — caps at 0.99 for high-confidence memories", async () => {
    const existingId = await insertMemory(client, {
      content: "User prefers vim",
      confidence: 0.99,
    });

    const newConfidence = Math.min(Math.max(0.99, 0.85), 0.99);
    await client.execute({
      sql: `UPDATE memories SET content = ?, confidence = ? WHERE id = ?`,
      args: ["User prefers neovim", newConfidence, existingId],
    });

    const corrected = (await getMemory(client, existingId))!;
    expect(corrected.confidence).toBe(0.99);
  });

  it("resolution: add_detail — appends to existing detail", async () => {
    const existingId = await insertMemory(client, {
      content: "User works at Acme Corp",
      detail: "Engineering team",
    });

    const existingMem = (await getMemory(client, existingId))!;
    const oldDetail = existingMem.detail as string;
    const newDetail = oldDetail + "\n" + "Leads the platform team";

    await client.execute({
      sql: `UPDATE memories SET detail = ? WHERE id = ?`,
      args: [newDetail, existingId],
    });

    const updated = (await getMemory(client, existingId))!;
    expect(updated.detail).toBe("Engineering team\nLeads the platform team");
  });

  it("resolution: add_detail — creates detail when none exists", async () => {
    const existingId = await insertMemory(client, {
      content: "User works at Acme Corp",
      detail: null,
    });

    const newDetail = "Leads the platform team";
    await client.execute({
      sql: `UPDATE memories SET detail = ? WHERE id = ?`,
      args: [newDetail, existingId],
    });

    const updated = (await getMemory(client, existingId))!;
    expect(updated.detail).toBe("Leads the platform team");
  });

  it("resolution: keep_both — inserts a new memory alongside existing", async () => {
    const existingId = await insertMemory(client, {
      content: "User likes morning meetings",
    });

    const newId = await insertMemory(client, {
      content: "User prefers meetings before 10am",
    });

    // Both memories exist
    expect(await getMemory(client, existingId)).toBeDefined();
    expect(await getMemory(client, newId)).toBeDefined();

    // Count total memories
    const countResult = await client.execute({
      sql: `SELECT COUNT(*) as c FROM memories WHERE deleted_at IS NULL`,
      args: [],
    });
    expect(countResult.rows[0].c).toBe(2);
  });

  it("resolution: skip — makes no changes", async () => {
    const existingId = await insertMemory(client, {
      content: "User likes coffee",
      confidence: 0.90,
    });

    // Skip: don't touch anything
    const mem = (await getMemory(client, existingId))!;
    expect(mem.content).toBe("User likes coffee");
    expect(mem.confidence).toBe(0.90);

    // Count stays at 1
    const countResult = await client.execute({
      sql: `SELECT COUNT(*) as c FROM memories WHERE deleted_at IS NULL`,
      args: [],
    });
    expect(countResult.rows[0].c).toBe(1);
  });

  it("engrams_meta table tracks last_modified", async () => {
    const beforeResult = await client.execute({
      sql: `SELECT value FROM engrams_meta WHERE key = 'last_modified'`,
      args: [],
    });
    expect(beforeResult.rows[0]).toBeDefined();

    await bumpLastModified(client);

    const afterResult = await client.execute({
      sql: `SELECT value FROM engrams_meta WHERE key = 'last_modified'`,
      args: [],
    });
    expect(afterResult.rows[0].value).not.toBe(beforeResult.rows[0].value);
  });

  it("has_pii_flag column exists on memories table", async () => {
    const id = await insertMemory(client, { content: "Test" });
    const mem = (await getMemory(client, id))!;
    expect(mem.has_pii_flag).toBe(0);
  });

  describe("dedup detection via FTS", () => {
    it("searchFTS finds existing memory with identical content", async () => {
      await insertMemory(client, { content: "User prefers dark mode in all editors" });

      const results = await searchFTS(client, "User prefers dark mode in all editors", 3);
      expect(results.length).toBeGreaterThanOrEqual(1);

      // Verify the rowid resolves to the actual memory
      const rowids = results.map((r) => r.rowid);
      const placeholders = rowids.map(() => "?").join(",");
      const existing = (await client.execute({
        sql: `SELECT * FROM memories WHERE rowid IN (${placeholders}) AND deleted_at IS NULL`,
        args: rowids,
      })).rows;

      expect(existing.length).toBeGreaterThanOrEqual(1);
      expect(existing[0].content).toBe("User prefers dark mode in all editors");
    });

    it("searchFTS finds memory with overlapping content", async () => {
      await insertMemory(client, { content: "James works at Sunrise Labs on AI projects" });

      const results = await searchFTS(client, "James is at Sunrise Labs building AI tools", 3);
      expect(results.length).toBeGreaterThanOrEqual(1);
    });

    it("searchFTS does not find unrelated content", async () => {
      await insertMemory(client, { content: "The weather in San Francisco is foggy" });

      const results = await searchFTS(client, "quantum computing research papers", 3);
      expect(results.length).toBe(0);
    });
  });
});
