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
  return resolve(tmpdir(), `lodis-update-hint-${randomBytes(8).toString("hex")}.db`);
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

  const client = new McpClient({ name: "update-hint-test", version: "0.0.0" }, { capabilities: {} });
  await client.connect(clientTransport);

  try {
    return await fn(client, dbUrl);
  } finally {
    await client.close();
  }
}

async function insertMemory(dbUrl: string, id: string, content: string, confidence: number): Promise<void> {
  const db = createClient({ url: dbUrl });
  await db.execute({
    sql: `INSERT INTO memories (id, content, domain, source_agent_id, source_agent_name, source_type, confidence, learned_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [id, content, "general", "seed", "Seed", "observed", confidence, new Date().toISOString()],
  });
  db.close();
}

describe("memory_update hint for content rewrites", () => {
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

  it("includes hint when content is rewritten on a 0.75 confidence record", async () => {
    const result = await withServer(dbPath, async (client, dbUrl) => {
      const id = randomBytes(16).toString("hex");
      await insertMemory(dbUrl, id, "Jane Zhu — imported contact skeleton", 0.75);

      const raw = await client.callTool({
        name: "memory_update",
        arguments: {
          id,
          content: "Jane Zhu — VP of Product at OpenAI. Met at SF AI Summit 2026. Interested in memory UX for agents.",
        },
      });
      return parseResult<{ updated: boolean; hint?: string }>(raw);
    });

    expect(result.updated).toBe(true);
    expect(result.hint).toBeDefined();
    expect(result.hint).toContain("memory_correct");
    expect(result.hint).toContain("0.90");
  });

  it("omits hint on metadata-only change on a 0.75 confidence record", async () => {
    const result = await withServer(dbPath, async (client, dbUrl) => {
      const id = randomBytes(16).toString("hex");
      await insertMemory(dbUrl, id, "Jane Zhu — contact", 0.75);

      const raw = await client.callTool({
        name: "memory_update",
        arguments: {
          id,
          entityType: "person",
          entityName: "Jane Zhu",
        },
      });
      return parseResult<{ updated: boolean; hint?: string }>(raw);
    });

    expect(result.updated).toBe(true);
    expect(result.hint).toBeUndefined();
  });

  it("omits hint when confidence is already ≥0.9", async () => {
    const result = await withServer(dbPath, async (client, dbUrl) => {
      const id = randomBytes(16).toString("hex");
      await insertMemory(dbUrl, id, "Jane Zhu — existing rich content", 0.95);

      const raw = await client.callTool({
        name: "memory_update",
        arguments: {
          id,
          content: "Jane Zhu — updated rich content",
        },
      });
      return parseResult<{ updated: boolean; hint?: string }>(raw);
    });

    expect(result.updated).toBe(true);
    expect(result.hint).toBeUndefined();
  });

  it("omits hint when content is unchanged", async () => {
    const sameContent = "Jane Zhu — contact";
    const result = await withServer(dbPath, async (client, dbUrl) => {
      const id = randomBytes(16).toString("hex");
      await insertMemory(dbUrl, id, sameContent, 0.75);

      const raw = await client.callTool({
        name: "memory_update",
        arguments: {
          id,
          content: sameContent,
        },
      });
      return parseResult<{ updated: boolean; hint?: string }>(raw);
    });

    expect(result.updated).toBe(true);
    expect(result.hint).toBeUndefined();
  });
});
