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
  return resolve(tmpdir(), `lodis-supersede-${randomBytes(8).toString("hex")}.db`);
}

interface ToolResult {
  content: Array<{ type: string; text: string }>;
}
function parseResult<T>(raw: unknown): T {
  return JSON.parse((raw as ToolResult).content[0].text) as T;
}

async function withServer<T>(
  dbPath: string,
  fn: (client: McpClient, dbUrl: string) => Promise<T>,
): Promise<T> {
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  const dbUrl = "file:" + dbPath;
  await startServer({ transport: serverTransport, dbUrl });
  const client = new McpClient({ name: "supersede-test", version: "0.0.0" }, { capabilities: {} });
  await client.connect(clientTransport);
  try {
    return await fn(client, dbUrl);
  } finally {
    await client.close();
  }
}

describe("memory_write supersede resolution (Phase 3 temporal)", () => {
  let dbPath: string;
  beforeEach(() => {
    dbPath = tempDbPath();
  });
  afterEach(() => {
    try {
      for (const s of ["", "-wal", "-shm"]) {
        const p = dbPath + s;
        if (existsSync(p)) unlinkSync(p);
      }
    } catch {
      // best-effort
    }
  });

  it("preserves the prior fact and stores the new one as current", async () => {
    await withServer(dbPath, async (client, dbUrl) => {
      const db = createClient({ url: dbUrl });
      const oldId = randomBytes(16).toString("hex");
      const ts = new Date().toISOString();
      // Seed a current fact.
      await db.execute({
        sql: `INSERT INTO memories (id, content, domain, source_agent_id, source_agent_name, source_type, confidence, learned_at, valid_from)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [oldId, "James works at Acme", "work", "seed", "Seed", "stated", 0.9, ts, ts],
      });

      // Supersede it via the new resolution.
      const raw = await client.callTool({
        name: "memory_write",
        arguments: {
          content: "James works at Initech",
          domain: "work",
          sourceAgentId: "test",
          sourceAgentName: "Test",
          sourceType: "stated",
          resolution: "supersede",
          existingMemoryId: oldId,
        },
      });
      const res = parseResult<{ status: string; id: string; supersededId: string }>(raw);
      expect(res.status).toBe("superseded");
      expect(res.supersededId).toBe(oldId);
      const newId = res.id;
      expect(newId).toBeTruthy();
      expect(newId).not.toBe(oldId);

      // Prior fact: valid_to set + superseded_by points to the successor.
      const oldRow = (await db.execute({ sql: `SELECT valid_to, superseded_by FROM memories WHERE id = ?`, args: [oldId] })).rows[0];
      expect(oldRow.valid_to).not.toBeNull();
      expect(oldRow.superseded_by).toBe(newId);

      // New fact: current (valid_to NULL, valid_from set).
      const newRow = (await db.execute({ sql: `SELECT valid_from, valid_to, content FROM memories WHERE id = ?`, args: [newId] })).rows[0];
      expect(newRow.valid_to).toBeNull();
      expect(newRow.valid_from).not.toBeNull();
      expect(newRow.content).toBe("James works at Initech");

      // Typed history edge: new --supersedes--> old.
      const edge = (await db.execute({ sql: `SELECT relationship FROM memory_connections WHERE source_memory_id = ? AND target_memory_id = ?`, args: [newId, oldId] })).rows[0];
      expect(edge?.relationship).toBe("supersedes");
      db.close();

      // Default search returns only the current fact, annotated with supersededCount.
      const sRaw = await client.callTool({ name: "memory_search", arguments: { query: "James works" } });
      const s = parseResult<{ memories: Array<{ id: string; _supersededCount?: number }> }>(sRaw);
      const ids = s.memories.map((m) => m.id);
      expect(ids).toContain(newId);
      expect(ids).not.toContain(oldId);
      expect(s.memories.find((m) => m.id === newId)?._supersededCount).toBe(1);

      // includeSuperseded surfaces the history.
      const hRaw = await client.callTool({ name: "memory_search", arguments: { query: "James works", includeSuperseded: true } });
      const h = parseResult<{ memories: Array<{ id: string }> }>(hRaw);
      expect(h.memories.map((m) => m.id)).toContain(oldId);
    });
  });

  it("handles a multi-step supersession chain (A -> B -> C)", async () => {
    await withServer(dbPath, async (client, dbUrl) => {
      const db = createClient({ url: dbUrl });
      const idA = randomBytes(16).toString("hex");
      const ts = new Date().toISOString();
      await db.execute({
        sql: `INSERT INTO memories (id, content, domain, source_agent_id, source_agent_name, source_type, confidence, learned_at, valid_from)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [idA, "James works at Acme", "work", "seed", "Seed", "stated", 0.9, ts, ts],
      });

      const supersede = async (existingId: string, content: string) => {
        const raw = await client.callTool({
          name: "memory_write",
          arguments: { content, domain: "work", sourceAgentId: "t", sourceAgentName: "T", sourceType: "stated", resolution: "supersede", existingMemoryId: existingId },
        });
        return parseResult<{ id: string }>(raw).id;
      };

      const idB = await supersede(idA, "James works at Initech");
      const idC = await supersede(idB, "James works at Globex");

      // Chain integrity: A->B->C, only C current.
      const rows = (await db.execute({ sql: `SELECT id, valid_to, superseded_by FROM memories WHERE id IN (?, ?, ?)`, args: [idA, idB, idC] })).rows as unknown as Array<{ id: string; valid_to: string | null; superseded_by: string | null }>;
      const byId = new Map(rows.map((r) => [r.id, r]));
      expect(byId.get(idA)!.superseded_by).toBe(idB);
      expect(byId.get(idA)!.valid_to).not.toBeNull();
      expect(byId.get(idB)!.superseded_by).toBe(idC);
      expect(byId.get(idB)!.valid_to).not.toBeNull();
      expect(byId.get(idC)!.valid_to).toBeNull(); // C is current
      db.close();

      // Default search returns only the current fact (C).
      const sRaw = await client.callTool({ name: "memory_search", arguments: { query: "James works" } });
      const s = parseResult<{ memories: Array<{ id: string; content: string; _supersededCount?: number }> }>(sRaw);
      const ids = s.memories.map((m) => m.id);
      expect(ids).toContain(idC);
      expect(ids).not.toContain(idA);
      expect(ids).not.toContain(idB);
      // supersededCount counts DIRECT predecessors (C directly superseded B => 1).
      // Full chain depth (A,B) is reachable by traversing superseded_by, not via this count.
      expect(s.memories.find((m) => m.id === idC)?._supersededCount).toBe(1);

      // History: includeSuperseded surfaces the whole chain.
      const hRaw = await client.callTool({ name: "memory_search", arguments: { query: "James works", includeSuperseded: true } });
      const hids = parseResult<{ memories: Array<{ id: string }> }>(hRaw).memories.map((m) => m.id);
      expect(hids).toEqual(expect.arrayContaining([idA, idB, idC]));
    });
  });
});
