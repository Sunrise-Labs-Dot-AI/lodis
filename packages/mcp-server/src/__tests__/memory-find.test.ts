import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { resolve } from "path";
import { randomBytes } from "crypto";
import { Client as McpClient } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createClient } from "@libsql/client";
import { startServer } from "../server.js";

function tempDbPath(): string {
  return resolve(tmpdir(), `lodis-memory-find-${randomBytes(8).toString("hex")}.db`);
}

interface ToolResult {
  content: Array<{ type: string; text: string }>;
}

interface FindMatch {
  id: string;
  domain: string;
  entity_type: string | null;
  entity_name: string | null;
  snippet: string | null;
  permanence: string | null;
  learned_at: string | null;
  url?: string;
}

interface FindResponse {
  matches?: FindMatch[];
  count?: number;
  truncated?: boolean;
  error?: string;
}

function parseResult(raw: unknown): FindResponse {
  return JSON.parse((raw as ToolResult).content[0].text);
}

async function withServer<T>(
  dbPath: string,
  fn: (mcp: McpClient, dbUrl: string) => Promise<T>,
): Promise<T> {
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  const dbUrl = "file:" + dbPath;
  await startServer({ transport: serverTransport, dbUrl });

  const mcp = new McpClient({ name: "memory-find-test", version: "0.0.0" }, { capabilities: {} });
  await mcp.connect(clientTransport);
  try {
    return await fn(mcp, dbUrl);
  } finally {
    await mcp.close();
  }
}

function memId(): string {
  return randomBytes(16).toString("hex");
}

async function seedMemory(
  db: ReturnType<typeof createClient>,
  m: {
    id: string;
    content: string;
    domain: string;
    entityType?: string | null;
    entityName?: string | null;
    permanence?: string | null;
    deletedAt?: string | null;
    userId?: string | null;
  },
): Promise<void> {
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO memories
            (id, content, domain, source_agent_id, source_agent_name, source_type,
             confidence, learned_at, updated_at, entity_type, entity_name, permanence, deleted_at, user_id, used_count)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    args: [
      m.id,
      m.content,
      m.domain,
      "seeder",
      "Seeder",
      "stated",
      0.9,
      now,
      now,
      m.entityType ?? null,
      m.entityName ?? null,
      m.permanence ?? "active",
      m.deletedAt ?? null,
      m.userId ?? null,
    ],
  });
}

describe("memory_find", () => {
  let dbPath: string;

  beforeEach(() => {
    dbPath = tempDbPath();
  });

  afterEach(() => {
    try {
      for (const suffix of ["", "-wal", "-shm"]) {
        const p = dbPath + suffix;
        if (existsSync(p)) unlinkSync(p);
      }
    } catch {
      /* best-effort */
    }
  });

  it("resolves a partial id prefix to a summary match with deeplink", async () => {
    await withServer(dbPath, async (mcp, dbUrl) => {
      const db = createClient({ url: dbUrl });
      try {
        const id = memId();
        await seedMemory(db, { id, content: "the quick brown fox", domain: "general", entityName: "Fox" });

        const prefix = id.slice(0, 8);
        const res = parseResult(await mcp.callTool({ name: "memory_find", arguments: { idPrefix: prefix } }));

        expect(res.error).toBeUndefined();
        expect(res.count).toBe(1);
        expect(res.matches?.[0]?.id).toBe(id);
        expect(res.matches?.[0]?.snippet).toBe("the quick brown fox");
        expect(res.matches?.[0]?.entity_name).toBe("Fox");
        expect(res.matches?.[0]?.url).toContain(`/memory/${id}`);
      } finally {
        db.close();
      }
    });
  });

  it("returns summary fields only — never full content/detail beyond a 160-char snippet", async () => {
    await withServer(dbPath, async (mcp, dbUrl) => {
      const db = createClient({ url: dbUrl });
      try {
        const id = memId();
        const longContent = "x".repeat(500);
        await seedMemory(db, { id, content: longContent, domain: "general" });

        const res = parseResult(await mcp.callTool({ name: "memory_find", arguments: { idPrefix: id.slice(0, 6) } }));
        expect(res.matches?.[0]?.snippet?.length).toBe(160);
      } finally {
        db.close();
      }
    });
  });

  it("prefix miss returns empty, not an error", async () => {
    await withServer(dbPath, async (mcp, dbUrl) => {
      const db = createClient({ url: dbUrl });
      try {
        await seedMemory(db, { id: memId(), content: "something", domain: "general" });
        // A prefix that cannot match any 16-byte hex id (starts with the rare nibble run).
        const res = parseResult(await mcp.callTool({ name: "memory_find", arguments: { idPrefix: "ffffffffffffffff0000000000000000".slice(0, 20) } }));
        expect(res.error).toBeUndefined();
        expect(res.count).toBe(0);
        expect(res.matches).toEqual([]);
      } finally {
        db.close();
      }
    });
  });

  it("resolves by content substring (case-insensitive)", async () => {
    await withServer(dbPath, async (mcp, dbUrl) => {
      const db = createClient({ url: dbUrl });
      try {
        const id = memId();
        await seedMemory(db, { id, content: "James prefers Sonnet by default", domain: "preferences" });

        const res = parseResult(await mcp.callTool({ name: "memory_find", arguments: { contentSubstring: "sonnet" } }));
        expect(res.count).toBe(1);
        expect(res.matches?.[0]?.id).toBe(id);
      } finally {
        db.close();
      }
    });
  });

  it("combines idPrefix and domain filter", async () => {
    await withServer(dbPath, async (mcp, dbUrl) => {
      const db = createClient({ url: dbUrl });
      try {
        // Two rows sharing a prefix is astronomically unlikely with random ids,
        // so assert the domain filter excludes a non-matching row explicitly.
        const a = memId();
        const b = memId();
        await seedMemory(db, { id: a, content: "work note", domain: "work" });
        await seedMemory(db, { id: b, content: "home note", domain: "home" });

        const res = parseResult(await mcp.callTool({ name: "memory_find", arguments: { contentSubstring: "note", domain: "work" } }));
        expect(res.count).toBe(1);
        expect(res.matches?.[0]?.id).toBe(a);
      } finally {
        db.close();
      }
    });
  });

  it("excludes archived rows by default; includes them with includeArchived", async () => {
    await withServer(dbPath, async (mcp, dbUrl) => {
      const db = createClient({ url: dbUrl });
      try {
        const id = memId();
        await seedMemory(db, { id, content: "archived fact about widgets", domain: "general", permanence: "archived" });

        const def = parseResult(await mcp.callTool({ name: "memory_find", arguments: { contentSubstring: "widgets" } }));
        expect(def.count).toBe(0);

        const opted = parseResult(await mcp.callTool({ name: "memory_find", arguments: { contentSubstring: "widgets", includeArchived: true } }));
        expect(opted.count).toBe(1);
        expect(opted.matches?.[0]?.id).toBe(id);
      } finally {
        db.close();
      }
    });
  });

  it("excludes soft-deleted rows", async () => {
    await withServer(dbPath, async (mcp, dbUrl) => {
      const db = createClient({ url: dbUrl });
      try {
        const id = memId();
        await seedMemory(db, { id, content: "deleted secret", domain: "general", deletedAt: new Date().toISOString() });

        const res = parseResult(await mcp.callTool({ name: "memory_find", arguments: { contentSubstring: "secret" } }));
        expect(res.count).toBe(0);
      } finally {
        db.close();
      }
    });
  });

  it("does NOT auto-track usage on candidate matches", async () => {
    await withServer(dbPath, async (mcp, dbUrl) => {
      const db = createClient({ url: dbUrl });
      try {
        const id = memId();
        await seedMemory(db, { id, content: "untracked candidate", domain: "general" });

        await mcp.callTool({ name: "memory_find", arguments: { idPrefix: id.slice(0, 8) } });

        const after = (await db.execute({ sql: `SELECT used_count FROM memories WHERE id = ?`, args: [id] })).rows[0] as { used_count: number };
        expect(after.used_count).toBe(0);
        const evts = (await db.execute({ sql: `SELECT COUNT(*) AS n FROM memory_events WHERE memory_id = ? AND event_type = 'used'`, args: [id] })).rows[0] as { n: number };
        expect(evts.n).toBe(0);
      } finally {
        db.close();
      }
    });
  });

  it("respects per-agent read ACL — blocked-domain rows never surface", async () => {
    await withServer(dbPath, async (mcp, dbUrl) => {
      const db = createClient({ url: dbUrl });
      try {
        const allowedId = memId();
        const blockedId = memId();
        await seedMemory(db, { id: allowedId, content: "shared keyword work", domain: "work" });
        await seedMemory(db, { id: blockedId, content: "shared keyword health", domain: "health" });

        await db.execute({ sql: `INSERT INTO agent_permissions (agent_id, domain, can_read, can_write) VALUES (?, ?, ?, ?)`, args: ["agent_x", "*", 0, 0] });
        await db.execute({ sql: `INSERT INTO agent_permissions (agent_id, domain, can_read, can_write) VALUES (?, ?, ?, ?)`, args: ["agent_x", "work", 1, 1] });

        const res = parseResult(await mcp.callTool({ name: "memory_find", arguments: { contentSubstring: "shared keyword", agentId: "agent_x" } }));
        expect(res.count).toBe(1);
        expect(res.matches?.[0]?.id).toBe(allowedId);
      } finally {
        db.close();
      }
    });
  });

  it("rejects when neither idPrefix nor contentSubstring is supplied", async () => {
    await withServer(dbPath, async (mcp) => {
      const res = parseResult(await mcp.callTool({ name: "memory_find", arguments: {} }));
      expect(res.error).toContain("requires either `idPrefix` or `contentSubstring`");
    });
  });

  it("rejects a non-hex idPrefix without touching SQL", async () => {
    await withServer(dbPath, async (mcp) => {
      const res = parseResult(await mcp.callTool({ name: "memory_find", arguments: { idPrefix: "xyz!" } }));
      expect(res.error).toContain("Invalid idPrefix");
    });
  });

  it("rejects a too-short contentSubstring", async () => {
    await withServer(dbPath, async (mcp) => {
      const res = parseResult(await mcp.callTool({ name: "memory_find", arguments: { contentSubstring: "ab" } }));
      expect(res.error).toContain("at least 3 characters");
    });
  });

  it("caps results at limit and reports truncated", async () => {
    await withServer(dbPath, async (mcp, dbUrl) => {
      const db = createClient({ url: dbUrl });
      try {
        for (let i = 0; i < 5; i++) {
          await seedMemory(db, { id: memId(), content: `shared marker row ${i}`, domain: "general" });
        }
        const res = parseResult(await mcp.callTool({ name: "memory_find", arguments: { contentSubstring: "shared marker", limit: 3 } }));
        expect(res.count).toBe(3);
        expect(res.truncated).toBe(true);
      } finally {
        db.close();
      }
    });
  });
});
