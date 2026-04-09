import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, unlinkSync } from "fs";
import { resolve } from "path";
import { tmpdir } from "os";
import { randomBytes } from "crypto";
import { createDatabase, bumpLastModified } from "../db.js";
import { searchFTS } from "../fts.js";

function tempDbPath(): string {
  return resolve(tmpdir(), `engrams-test-${randomBytes(8).toString("hex")}.db`);
}

function insertMemory(
  sqlite: ReturnType<typeof createDatabase>["sqlite"],
  id: string,
  content: string,
  opts: {
    confidence?: number;
    domain?: string;
    entityType?: string;
    entityName?: string;
    learnedAt?: string;
  } = {},
) {
  sqlite
    .prepare(
      `INSERT INTO memories (id, content, domain, source_agent_id, source_agent_name, source_type, confidence, learned_at, entity_type, entity_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      content,
      opts.domain ?? "general",
      "agent1",
      "test",
      "stated",
      opts.confidence ?? 0.9,
      opts.learnedAt ?? new Date().toISOString(),
      opts.entityType ?? null,
      opts.entityName ?? null,
    );
}

function insertConnection(
  sqlite: ReturnType<typeof createDatabase>["sqlite"],
  sourceId: string,
  targetId: string,
  relationship: string,
) {
  sqlite
    .prepare(`INSERT INTO memory_connections (source_memory_id, target_memory_id, relationship) VALUES (?, ?, ?)`)
    .run(sourceId, targetId, relationship);
}

describe("search", () => {
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

  describe("FTS5 search", () => {
    it("finds memories by keyword", () => {
      insertMemory(sqlite, "m1", "TypeScript is my preferred language");
      insertMemory(sqlite, "m2", "I enjoy morning coffee");
      insertMemory(sqlite, "m3", "Python is also useful for scripting");

      const results = searchFTS(sqlite, "TypeScript");
      expect(results.length).toBe(1);
    });

    it("returns empty for no matches", () => {
      insertMemory(sqlite, "m1", "Hello world");
      const results = searchFTS(sqlite, "nonexistent");
      expect(results).toEqual([]);
    });

    it("searches entity_name in FTS index", () => {
      insertMemory(sqlite, "m1", "She is my manager", { entityName: "Sarah Chen" });
      const results = searchFTS(sqlite, "Sarah Chen");
      expect(results.length).toBe(1);
    });

    it("respects limit parameter", () => {
      for (let i = 0; i < 10; i++) {
        insertMemory(sqlite, `m${i}`, `TypeScript tip number ${i}`);
      }
      const results = searchFTS(sqlite, "TypeScript", 3);
      expect(results.length).toBe(3);
    });
  });

  describe("entity filters (SQL level)", () => {
    it("filters by entity_type", () => {
      insertMemory(sqlite, "m1", "Sarah is my manager", { entityType: "person", entityName: "Sarah" });
      insertMemory(sqlite, "m2", "Acme Corp builds SaaS", { entityType: "organization", entityName: "Acme" });
      insertMemory(sqlite, "m3", "I prefer dark mode", { entityType: "preference" });

      const personResults = sqlite
        .prepare(`SELECT * FROM memories WHERE entity_type = ? AND deleted_at IS NULL`)
        .all("person") as Record<string, unknown>[];
      expect(personResults.length).toBe(1);
      expect(personResults[0].id).toBe("m1");
    });

    it("filters by entity_name case-insensitively", () => {
      insertMemory(sqlite, "m1", "Sarah is my manager", { entityType: "person", entityName: "Sarah Chen" });

      const results = sqlite
        .prepare(`SELECT * FROM memories WHERE entity_name = ? COLLATE NOCASE AND deleted_at IS NULL`)
        .all("sarah chen") as Record<string, unknown>[];
      expect(results.length).toBe(1);
    });
  });

  describe("connections", () => {
    it("stores and retrieves connections between memories", () => {
      insertMemory(sqlite, "m1", "Sarah is my manager");
      insertMemory(sqlite, "m2", "Acme Corp is my employer");
      insertConnection(sqlite, "m1", "m2", "works_at");

      const outgoing = sqlite
        .prepare(`SELECT * FROM memory_connections WHERE source_memory_id = ?`)
        .all("m1") as Record<string, unknown>[];
      expect(outgoing.length).toBe(1);
      expect(outgoing[0].relationship).toBe("works_at");
    });

    it("supports multiple relationship types", () => {
      insertMemory(sqlite, "m1", "Dogs are great pets");
      insertMemory(sqlite, "m2", "Cats are better pets");
      insertConnection(sqlite, "m1", "m2", "contradicts");

      insertMemory(sqlite, "m3", "Regular exercise is important");
      insertMemory(sqlite, "m4", "Morning walks are my favorite");
      insertConnection(sqlite, "m3", "m4", "supports");

      const all = sqlite.prepare(`SELECT * FROM memory_connections`).all() as Record<string, unknown>[];
      expect(all.length).toBe(2);
    });

    it("follows bidirectional connections", () => {
      insertMemory(sqlite, "m1", "Memory A");
      insertMemory(sqlite, "m2", "Memory B");
      insertConnection(sqlite, "m1", "m2", "related");

      const outgoing = sqlite
        .prepare(`SELECT * FROM memory_connections WHERE source_memory_id = ?`)
        .all("m1");
      const incoming = sqlite
        .prepare(`SELECT * FROM memory_connections WHERE target_memory_id = ?`)
        .all("m1");
      expect(outgoing.length).toBe(1);
      expect(incoming.length).toBe(0);

      const incomingToM2 = sqlite
        .prepare(`SELECT * FROM memory_connections WHERE target_memory_id = ?`)
        .all("m2");
      expect(incomingToM2.length).toBe(1);
    });
  });

  describe("engrams_meta for cache invalidation", () => {
    it("stores last_modified timestamp", () => {
      const row = sqlite
        .prepare(`SELECT value FROM engrams_meta WHERE key = 'last_modified'`)
        .get() as { value: string };
      expect(row.value).toBeDefined();
    });

    it("updates last_modified on bumpLastModified", () => {
      const before = (sqlite.prepare(`SELECT value FROM engrams_meta WHERE key = 'last_modified'`).get() as { value: string }).value;

      // Small delay to ensure different timestamp
      bumpLastModified(sqlite);

      const after = (sqlite.prepare(`SELECT value FROM engrams_meta WHERE key = 'last_modified'`).get() as { value: string }).value;
      expect(after).not.toBe(before);
    });
  });
});
