// §A prerequisite test for the Agent Permissions redesign (see plan
// the-agent-permissions-tool-cached-hummingbird.md).
//
// This test is the gate: it asserts the existing enforcement functions
// (checkPermission / applyReadFilter / getAllowedDomains) honor the
// "Isolated + allowlist" pattern — wildcard deny `(*, 0, 0)` plus an
// explicit allow row `(domain, 1, 1)` — so the new UI can express
// "isolated mode" by writing these rows without any change to the
// MCP server's enforcement path.
//
// If this test fails, the "no enforcement changes" premise is false
// and the plan must be revised before any UI work is built.

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
  return resolve(tmpdir(), `lodis-isolated-allowlist-${randomBytes(8).toString("hex")}.db`);
}

interface ToolResult {
  content: Array<{ type: string; text: string }>;
}

interface SearchMemory {
  id: string;
  domain: string;
  content: string;
}

interface SearchResponse {
  memories: SearchMemory[];
  count: number;
}

function parseSearch(raw: unknown): SearchResponse {
  const data = raw as ToolResult;
  return JSON.parse(data.content[0].text);
}

async function withServer<T>(
  dbPath: string,
  fn: (client: McpClient, dbUrl: string) => Promise<T>,
): Promise<T> {
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  const dbUrl = "file:" + dbPath;
  await startServer({ transport: serverTransport, dbUrl });

  const client = new McpClient({ name: "isolated-allowlist-test", version: "0.0.0" }, { capabilities: {} });
  await client.connect(clientTransport);
  try {
    return await fn(client, dbUrl);
  } finally {
    await client.close();
  }
}

function memId(): string {
  return randomBytes(16).toString("hex");
}

describe("memory_search — Isolated + allowlist gate (§A prerequisite)", () => {
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

  it("returns only allowlisted domains when wildcard deny + allow row exist", async () => {
    await withServer(dbPath, async (mcp, dbUrl) => {
      const db = createClient({ url: dbUrl });
      try {
        const now = new Date().toISOString();
        const seeds = [
          { id: memId(), domain: "a", content: "alpha banana salmon" },
          { id: memId(), domain: "b", content: "bravo banana salmon" },
          { id: memId(), domain: "c", content: "charlie banana salmon" },
        ];
        for (const s of seeds) {
          await db.execute({
            sql: `INSERT INTO memories (id, content, domain, source_agent_id, source_agent_name, source_type, confidence, learned_at, updated_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            args: [s.id, s.content, s.domain, "seeder", "Seeder", "stated", 0.9, now, now],
          });
        }

        await db.execute({
          sql: `INSERT INTO agent_permissions (agent_id, domain, can_read, can_write) VALUES (?, ?, ?, ?)`,
          args: ["agent_x", "*", 0, 0],
        });
        await db.execute({
          sql: `INSERT INTO agent_permissions (agent_id, domain, can_read, can_write) VALUES (?, ?, ?, ?)`,
          args: ["agent_x", "a", 1, 1],
        });

        const raw = await mcp.callTool({
          name: "memory_search",
          arguments: { query: "banana salmon", agentId: "agent_x", limit: 20, expand: false },
        });
        const res = parseSearch(raw);

        expect(res.count).toBeGreaterThan(0);
        expect(res.memories.every(m => m.domain === "a")).toBe(true);
        expect(res.memories.map(m => m.domain)).not.toContain("b");
        expect(res.memories.map(m => m.domain)).not.toContain("c");
      } finally {
        db.close();
      }
    });
  });

  it("returns everything when agent has no rules (baseline: no enforcement)", async () => {
    await withServer(dbPath, async (mcp, dbUrl) => {
      const db = createClient({ url: dbUrl });
      try {
        const now = new Date().toISOString();
        const seeds = [
          { id: memId(), domain: "a", content: "alpha tomato kiwi" },
          { id: memId(), domain: "b", content: "bravo tomato kiwi" },
          { id: memId(), domain: "c", content: "charlie tomato kiwi" },
        ];
        for (const s of seeds) {
          await db.execute({
            sql: `INSERT INTO memories (id, content, domain, source_agent_id, source_agent_name, source_type, confidence, learned_at, updated_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            args: [s.id, s.content, s.domain, "seeder", "Seeder", "stated", 0.9, now, now],
          });
        }

        const raw = await mcp.callTool({
          name: "memory_search",
          arguments: { query: "tomato kiwi", agentId: "unknown_agent", limit: 20, expand: false },
        });
        const res = parseSearch(raw);

        const domains = new Set(res.memories.map(m => m.domain));
        expect(domains.has("a")).toBe(true);
        expect(domains.has("b")).toBe(true);
        expect(domains.has("c")).toBe(true);
      } finally {
        db.close();
      }
    });
  });

  it("fails closed when wildcard deny has no allow rows (empty allowlist)", async () => {
    await withServer(dbPath, async (mcp, dbUrl) => {
      const db = createClient({ url: dbUrl });
      try {
        const now = new Date().toISOString();
        const seeds = [
          { id: memId(), domain: "a", content: "alpha pepper grape" },
          { id: memId(), domain: "b", content: "bravo pepper grape" },
        ];
        for (const s of seeds) {
          await db.execute({
            sql: `INSERT INTO memories (id, content, domain, source_agent_id, source_agent_name, source_type, confidence, learned_at, updated_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            args: [s.id, s.content, s.domain, "seeder", "Seeder", "stated", 0.9, now, now],
          });
        }

        await db.execute({
          sql: `INSERT INTO agent_permissions (agent_id, domain, can_read, can_write) VALUES (?, ?, ?, ?)`,
          args: ["agent_locked", "*", 0, 0],
        });

        const raw = await mcp.callTool({
          name: "memory_search",
          arguments: { query: "pepper grape", agentId: "agent_locked", limit: 20, expand: false },
        });
        const res = parseSearch(raw);
        expect(res.memories.length).toBe(0);
      } finally {
        db.close();
      }
    });
  });
});
