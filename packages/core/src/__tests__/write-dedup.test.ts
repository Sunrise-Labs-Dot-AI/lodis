import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, unlinkSync } from "fs";
import { resolve } from "path";
import { tmpdir } from "os";
import { randomBytes } from "crypto";
import { createDatabase, bumpLastModified } from "../db.js";

function tempDbPath(): string {
  return resolve(tmpdir(), `engrams-dedup-${randomBytes(8).toString("hex")}.db`);
}

function generateId(): string {
  return randomBytes(16).toString("hex");
}

function now(): string {
  return new Date().toISOString();
}

function insertMemory(
  sqlite: ReturnType<typeof createDatabase>["sqlite"],
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
  sqlite
    .prepare(
      `INSERT INTO memories (id, content, detail, domain, source_agent_id, source_agent_name, source_type, confidence, corrected_count, learned_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
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
    );
  return id;
}

function getMemory(sqlite: ReturnType<typeof createDatabase>["sqlite"], id: string) {
  return sqlite
    .prepare(`SELECT * FROM memories WHERE id = ? AND deleted_at IS NULL`)
    .get(id) as Record<string, unknown> | undefined;
}

describe("write dedup resolution", () => {
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

  it("inserts new memory when no similar exists", () => {
    const id = insertMemory(sqlite, { content: "User prefers dark mode" });
    const mem = getMemory(sqlite, id);
    expect(mem).toBeDefined();
    expect(mem!.content).toBe("User prefers dark mode");
  });

  it("resolution: update — replaces content and bumps confidence", () => {
    const existingId = insertMemory(sqlite, {
      content: "User likes Python",
      confidence: 0.85,
    });

    // Simulate "update" resolution
    const newContent = "User prefers Python for data science";
    const newDetail = "Mentioned during a project discussion";
    const existingMem = getMemory(sqlite, existingId)!;
    const oldConfidence = existingMem.confidence as number;
    const newConfidence = Math.min(oldConfidence + 0.02, 0.99);

    sqlite
      .prepare(`UPDATE memories SET content = ?, detail = ?, confidence = ? WHERE id = ?`)
      .run(newContent, newDetail, newConfidence, existingId);

    const updated = getMemory(sqlite, existingId)!;
    expect(updated.content).toBe(newContent);
    expect(updated.detail).toBe(newDetail);
    expect(updated.confidence).toBeCloseTo(0.87, 2);
  });

  it("resolution: correct — updates content and boosts confidence to min(max(existing, 0.85), 0.99)", () => {
    // Low confidence memory
    const existingId = insertMemory(sqlite, {
      content: "User uses Java",
      confidence: 0.50,
    });

    const newContent = "User uses TypeScript";
    const existingMem = getMemory(sqlite, existingId)!;
    const oldConfidence = existingMem.confidence as number;
    const newConfidence = Math.min(Math.max(oldConfidence, 0.85), 0.99);
    const oldCorrectedCount = (existingMem.corrected_count as number) ?? 0;

    sqlite
      .prepare(`UPDATE memories SET content = ?, confidence = ?, corrected_count = ? WHERE id = ?`)
      .run(newContent, newConfidence, oldCorrectedCount + 1, existingId);

    const corrected = getMemory(sqlite, existingId)!;
    expect(corrected.content).toBe(newContent);
    expect(corrected.confidence).toBe(0.85); // max(0.50, 0.85)
    expect(corrected.corrected_count).toBe(1);
  });

  it("resolution: correct — caps at 0.99 for high-confidence memories", () => {
    const existingId = insertMemory(sqlite, {
      content: "User prefers vim",
      confidence: 0.99,
    });

    const newConfidence = Math.min(Math.max(0.99, 0.85), 0.99);
    sqlite
      .prepare(`UPDATE memories SET content = ?, confidence = ? WHERE id = ?`)
      .run("User prefers neovim", newConfidence, existingId);

    const corrected = getMemory(sqlite, existingId)!;
    expect(corrected.confidence).toBe(0.99);
  });

  it("resolution: add_detail — appends to existing detail", () => {
    const existingId = insertMemory(sqlite, {
      content: "User works at Acme Corp",
      detail: "Engineering team",
    });

    const existingMem = getMemory(sqlite, existingId)!;
    const oldDetail = existingMem.detail as string;
    const newDetail = oldDetail + "\n" + "Leads the platform team";

    sqlite
      .prepare(`UPDATE memories SET detail = ? WHERE id = ?`)
      .run(newDetail, existingId);

    const updated = getMemory(sqlite, existingId)!;
    expect(updated.detail).toBe("Engineering team\nLeads the platform team");
  });

  it("resolution: add_detail — creates detail when none exists", () => {
    const existingId = insertMemory(sqlite, {
      content: "User works at Acme Corp",
      detail: null,
    });

    const newDetail = "Leads the platform team";
    sqlite
      .prepare(`UPDATE memories SET detail = ? WHERE id = ?`)
      .run(newDetail, existingId);

    const updated = getMemory(sqlite, existingId)!;
    expect(updated.detail).toBe("Leads the platform team");
  });

  it("resolution: keep_both — inserts a new memory alongside existing", () => {
    const existingId = insertMemory(sqlite, {
      content: "User likes morning meetings",
    });

    const newId = insertMemory(sqlite, {
      content: "User prefers meetings before 10am",
    });

    // Both memories exist
    expect(getMemory(sqlite, existingId)).toBeDefined();
    expect(getMemory(sqlite, newId)).toBeDefined();

    // Count total memories
    const count = sqlite
      .prepare(`SELECT COUNT(*) as c FROM memories WHERE deleted_at IS NULL`)
      .get() as { c: number };
    expect(count.c).toBe(2);
  });

  it("resolution: skip — makes no changes", () => {
    const existingId = insertMemory(sqlite, {
      content: "User likes coffee",
      confidence: 0.90,
    });

    // Skip: don't touch anything
    const mem = getMemory(sqlite, existingId)!;
    expect(mem.content).toBe("User likes coffee");
    expect(mem.confidence).toBe(0.90);

    // Count stays at 1
    const count = sqlite
      .prepare(`SELECT COUNT(*) as c FROM memories WHERE deleted_at IS NULL`)
      .get() as { c: number };
    expect(count.c).toBe(1);
  });

  it("engrams_meta table tracks last_modified", () => {
    const before = sqlite
      .prepare(`SELECT value FROM engrams_meta WHERE key = 'last_modified'`)
      .get() as { value: string };
    expect(before).toBeDefined();

    bumpLastModified(sqlite);

    const after = sqlite
      .prepare(`SELECT value FROM engrams_meta WHERE key = 'last_modified'`)
      .get() as { value: string };
    expect(after.value).not.toBe(before.value);
  });

  it("has_pii_flag column exists on memories table", () => {
    const id = insertMemory(sqlite, { content: "Test" });
    const mem = getMemory(sqlite, id)!;
    expect(mem.has_pii_flag).toBe(0);
  });
});
