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
  return resolve(tmpdir(), `lodis-bulk-upload-${randomBytes(8).toString("hex")}.db`);
}

interface ToolResult {
  content: Array<{ type: string; text: string }>;
}

interface BulkResult {
  written: number;
  failed: number;
  skipped: number;
  results: Array<{ index: number; status: "written" | "failed" | "skipped"; id?: string; error?: string }>;
  durationMs: number;
}

function parseResult(raw: unknown): BulkResult {
  const data = raw as ToolResult;
  return JSON.parse(data.content[0].text);
}

async function withServer<T>(
  dbPath: string,
  fn: (client: McpClient, dbUrl: string) => Promise<T>,
): Promise<T> {
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  const dbUrl = "file:" + dbPath;
  // startServer runs the MCP server wired to this transport + DB
  await startServer({ transport: serverTransport, dbUrl });

  const client = new McpClient({ name: "bulk-test", version: "0.0.0" }, { capabilities: {} });
  await client.connect(clientTransport);

  try {
    return await fn(client, dbUrl);
  } finally {
    await client.close();
  }
}

describe("memory_bulk_upload MCP tool", () => {
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
      // best-effort
    }
  });

  it("uploads a batch end-to-end and persists memories", async () => {
    const result = await withServer(dbPath, async (client, dbUrl) => {
      const entries = Array.from({ length: 20 }, (_, i) => ({
        content: `Contact ${i}`,
        entityType: "person" as const,
        entityName: `Person ${i}`,
        domain: "contacts",
        structuredData: { resourceName: `people/c${i}` },
      }));

      const raw = await client.callTool({
        name: "memory_bulk_upload",
        arguments: {
          entries,
          sourceAgentId: "test-agent",
          sourceAgentName: "Test Agent",
          skipDedup: true,
        },
      });
      const parsed = parseResult(raw);

      // Verify DB state via a separate libsql connection
      const db = createClient({ url: dbUrl });
      const row = (await db.execute({
        sql: `SELECT COUNT(*) as c FROM memories WHERE deleted_at IS NULL`,
        args: [],
      })).rows[0] as unknown as { c: number };
      db.close();

      return { parsed, totalInDb: row.c };
    });

    expect(result.parsed.written).toBe(20);
    expect(result.parsed.failed).toBe(0);
    expect(result.parsed.results).toHaveLength(20);
    expect(result.parsed.results.every((r) => r.status === "written")).toBe(true);
    expect(result.totalInDb).toBe(20);
  });

  it("enforces agent permissions per unique domain, failing only blocked entries", async () => {
    // Pre-seed an agent_permissions row that blocks "secrets" for agent "restricted"
    const dbUrl = "file:" + dbPath;
    const seed = createClient({ url: dbUrl });
    // Tables are created lazily by startServer, so seed after server starts.
    seed.close();

    const result = await withServer(dbPath, async (client, dbUrl) => {
      const db = createClient({ url: dbUrl });
      // Block "secrets" for this agent; allow everything else implicitly.
      await db.execute({
        sql: `INSERT INTO agent_permissions (agent_id, domain, can_read, can_write) VALUES (?, ?, 1, 0)`,
        args: ["restricted", "secrets"],
      });
      db.close();

      const entries = [
        { content: "public entry 1", domain: "general" },
        { content: "secret entry", domain: "secrets" },
        { content: "public entry 2", domain: "general" },
        { content: "another secret", domain: "secrets" },
      ];

      const raw = await client.callTool({
        name: "memory_bulk_upload",
        arguments: {
          entries,
          sourceAgentId: "restricted",
          sourceAgentName: "Restricted Agent",
        },
      });
      return parseResult(raw);
    });

    expect(result.written).toBe(2);
    expect(result.failed).toBe(2);
    expect(result.results[0].status).toBe("written");
    expect(result.results[1].status).toBe("failed");
    expect(result.results[1].error).toContain("secrets");
    expect(result.results[2].status).toBe("written");
    expect(result.results[3].status).toBe("failed");
  });
});
