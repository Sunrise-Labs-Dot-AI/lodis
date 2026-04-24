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
  return resolve(tmpdir(), `lodis-snippet-type-${randomBytes(8).toString("hex")}.db`);
}

interface ToolResult {
  content: Array<{ type: string; text: string }>;
}

function parseResult<T>(raw: unknown): T {
  const data = raw as ToolResult;
  return JSON.parse(data.content[0].text) as T;
}

async function withServer<T>(
  dbPath: string,
  fn: (client: McpClient, dbUrl: string) => Promise<T>,
): Promise<T> {
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  const dbUrl = "file:" + dbPath;
  await startServer({ transport: serverTransport, dbUrl });

  const client = new McpClient({ name: "snippet-type-test", version: "0.0.0" }, { capabilities: {} });
  await client.connect(clientTransport);

  try {
    return await fn(client, dbUrl);
  } finally {
    await client.close();
  }
}

describe("snippet entityType plumbing", () => {
  let dbPath: string;

  beforeEach(() => { dbPath = tempDbPath(); });

  afterEach(() => {
    try {
      for (const suffix of ["", "-wal", "-shm"]) {
        const p = dbPath + suffix;
        if (existsSync(p)) unlinkSync(p);
      }
    } catch { /* best-effort */ }
  });

  it("memory_search returns a SQL-seeded snippet row when filtered by entityType='snippet'", async () => {
    const id = await withServer(dbPath, async (client, dbUrl) => {
      const db = createClient({ url: dbUrl });
      const memId = randomBytes(16).toString("hex");
      await db.execute({
        sql: `INSERT INTO memories (id, content, domain, source_agent_id, source_agent_name, source_type, confidence, learned_at, entity_type, entity_name)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [memId, "shipped PR #123", "fitness", "seed", "Seed", "observed", 1.0, new Date().toISOString(), "snippet", "Progress: Fitness"],
      });
      db.close();

      const raw = await client.callTool({
        name: "memory_search",
        arguments: { query: "shipped", entityType: "snippet" },
      });
      const out = parseResult<{ memories: Array<{ id: string; entity_type: string }> }>(raw);
      expect(out.memories.length).toBeGreaterThan(0);
      expect(out.memories.some((m) => m.entity_type === "snippet")).toBe(true);
      return memId;
    });
    expect(id).toMatch(/^[a-f0-9]{32}$/);
  });

  it("generic memory_write rejects entityType='snippet' with a redirect error", async () => {
    await withServer(dbPath, async (client) => {
      const raw = await client.callTool({
        name: "memory_write",
        arguments: {
          content: "attempt to smuggle a snippet via generic write",
          sourceAgentId: "test-agent",
          sourceAgentName: "Test Agent",
          sourceType: "observed",
          entityType: "snippet",
          resolution: "keep_both",
        },
      });
      const out = parseResult<{ error?: string; id?: string }>(raw);
      expect(out.error).toBeDefined();
      expect(out.error).toMatch(/memory_write_snippet/);
      expect(out.id).toBeUndefined();
    });
  });

  it("memory_bulk_upload marks snippet entries as failed with a redirect error", async () => {
    await withServer(dbPath, async (client) => {
      const raw = await client.callTool({
        name: "memory_bulk_upload",
        arguments: {
          sourceAgentId: "bulk-agent",
          sourceAgentName: "Bulk Agent",
          entries: [
            { content: "ok entry", domain: "general", entityType: "fact" },
            { content: "snippet entry should fail", domain: "general", entityType: "snippet" },
          ],
        },
      });
      const out = parseResult<{ results: Array<{ index: number; status: string; error?: string }> }>(raw);
      const snippetResult = out.results.find((r) => r.index === 1);
      expect(snippetResult?.status).toBe("failed");
      expect(snippetResult?.error).toMatch(/memory_write_snippet/);
    });
  });

  it("memory_search without an entityType filter still returns snippets alongside other types", async () => {
    await withServer(dbPath, async (client, dbUrl) => {
      const db = createClient({ url: dbUrl });
      const ts = new Date().toISOString();
      const snippetId = randomBytes(16).toString("hex");
      const factId = randomBytes(16).toString("hex");
      await db.execute({
        sql: `INSERT INTO memories (id, content, domain, source_agent_id, source_agent_name, source_type, confidence, learned_at, entity_type)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [snippetId, "deployed the widget today", "work", "seed", "Seed", "observed", 1.0, ts, "snippet"],
      });
      await db.execute({
        sql: `INSERT INTO memories (id, content, domain, source_agent_id, source_agent_name, source_type, confidence, learned_at, entity_type)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [factId, "widget uses react 19", "work", "seed", "Seed", "stated", 0.9, ts, "fact"],
      });
      db.close();

      const raw = await client.callTool({
        name: "memory_search",
        arguments: { query: "widget" },
      });
      const out = parseResult<{ memories: Array<{ id: string; entity_type: string | null }> }>(raw);
      const types = new Set(out.memories.map((m) => m.entity_type));
      expect(types.has("snippet")).toBe(true);
      expect(types.has("fact")).toBe(true);
    });
  });
});
