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
  return resolve(tmpdir(), `lodis-snippet-${randomBytes(8).toString("hex")}.db`);
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

  const client = new McpClient({ name: "snippet-test", version: "0.0.0" }, { capabilities: {} });
  await client.connect(clientTransport);

  try {
    return await fn(client, dbUrl);
  } finally {
    await client.close();
  }
}

async function registerTestDomain(dbUrl: string, name: string): Promise<void> {
  const db = createClient({ url: dbUrl });
  await db.execute({
    sql: `INSERT OR IGNORE INTO domains (name, created_at) VALUES (?, datetime('now'))`,
    args: [name],
  });
  db.close();
}

interface SnippetWriteResult {
  status?: string;
  error?: string;
  hint?: string;
  id?: string;
  permanence?: string;
  expires_at?: string | null;
  autoPin?: { permanence: string; ttl: string | null; reason: string } | null;
  url?: string;
}

describe("memory_write_snippet", () => {
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

  it("writes a valid snippet with default ephemeral/60d permanence", async () => {
    await withServer(dbPath, async (client, dbUrl) => {
      await registerTestDomain(dbUrl, "fitness");
      const raw = await client.callTool({
        name: "memory_write_snippet",
        arguments: {
          snippet_type: "advanced",
          life_domain: "fitness",
          content: "ran 5k in the morning",
          source_system: "manual",
          event_timestamp: new Date().toISOString(),
          sourceAgentId: "test-agent",
          sourceAgentName: "Test Agent",
        },
      });
      const r = parseResult<SnippetWriteResult>(raw);
      expect(r.status).toBe("written");
      expect(r.id).toMatch(/^[a-f0-9]{32}$/);
      expect(r.permanence).toBe("ephemeral");
      expect(r.expires_at).toBeTruthy();
      expect(r.autoPin).toBeNull();

      // Check DB row
      const db = createClient({ url: dbUrl });
      const row = (await db.execute({
        sql: `SELECT entity_type, entity_name, domain, event_ts, learned_at, expires_at, source_type, structured_data FROM memories WHERE id = ?`,
        args: [r.id!],
      })).rows[0] as unknown as {
        entity_type: string;
        entity_name: string;
        domain: string;
        event_ts: string;
        learned_at: string;
        expires_at: string;
        source_type: string;
        structured_data: string;
      };
      expect(row.entity_type).toBe("snippet");
      expect(row.entity_name).toBe("Progress: Fitness");
      expect(row.domain).toBe("fitness");
      expect(row.source_type).toBe("observed");
      expect(row.event_ts).toBeTruthy();
      // expires_at ~60 days from now (loose tolerance for slow parallel runs)
      const expiresMs = new Date(row.expires_at).getTime();
      const expected60d = Date.now() + 60 * 24 * 60 * 60 * 1000;
      expect(Math.abs(expiresMs - expected60d)).toBeLessThan(60_000);
      db.close();
    });
  });

  it("rejects writes to an unregistered domain", async () => {
    await withServer(dbPath, async (client) => {
      const raw = await client.callTool({
        name: "memory_write_snippet",
        arguments: {
          snippet_type: "started",
          life_domain: "unknown-domain",
          content: "nope",
          source_system: "manual",
          event_timestamp: new Date().toISOString(),
          sourceAgentId: "test-agent",
          sourceAgentName: "Test Agent",
        },
      });
      const r = parseResult<SnippetWriteResult>(raw);
      expect(r.error).toBe("domain_unregistered");
      expect(r.hint).toMatch(/memory_register_domain/);
    });
  });

  it("rejects writes to an archived domain with an unarchive hint", async () => {
    await withServer(dbPath, async (client, dbUrl) => {
      const db = createClient({ url: dbUrl });
      await db.execute({
        sql: `INSERT INTO domains (name, archived, archived_at, created_at) VALUES (?, 1, datetime('now'), datetime('now'))`,
        args: ["atlas"],
      });
      db.close();

      const raw = await client.callTool({
        name: "memory_write_snippet",
        arguments: {
          snippet_type: "shipped",
          life_domain: "atlas",
          content: "shipped thing",
          source_system: "github",
          event_timestamp: new Date().toISOString(),
          sourceAgentId: "test-agent",
          sourceAgentName: "Test Agent",
        },
      });
      const r = parseResult<SnippetWriteResult>(raw);
      expect(r.error).toBe("domain_archived");
      expect(r.hint).toMatch(/atlas/);
    });
  });

  it("rejects event_timestamp more than 1 hour in the future", async () => {
    await withServer(dbPath, async (client, dbUrl) => {
      await registerTestDomain(dbUrl, "work");
      const future = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
      const raw = await client.callTool({
        name: "memory_write_snippet",
        arguments: {
          snippet_type: "started",
          life_domain: "work",
          content: "predicting the future",
          source_system: "manual",
          event_timestamp: future,
          sourceAgentId: "test-agent",
          sourceAgentName: "Test Agent",
        },
      });
      const r = parseResult<SnippetWriteResult>(raw);
      expect(r.error).toBe("event_timestamp_in_future");
    });
  });

  it("rejects event_timestamp more than 180 days in the past", async () => {
    await withServer(dbPath, async (client, dbUrl) => {
      await registerTestDomain(dbUrl, "work");
      const old = new Date(Date.now() - 181 * 24 * 60 * 60 * 1000).toISOString();
      const raw = await client.callTool({
        name: "memory_write_snippet",
        arguments: {
          snippet_type: "started",
          life_domain: "work",
          content: "ancient history",
          source_system: "manual",
          event_timestamp: old,
          sourceAgentId: "test-agent",
          sourceAgentName: "Test Agent",
        },
      });
      const r = parseResult<SnippetWriteResult>(raw);
      expect(r.error).toBe("event_timestamp_too_old");
    });
  });

  it("dedups on (source_system, source_id, event_timestamp) when source_id is present", async () => {
    await withServer(dbPath, async (client, dbUrl) => {
      await registerTestDomain(dbUrl, "work");
      const ts = new Date().toISOString();
      const args = {
        snippet_type: "shipped",
        life_domain: "work",
        content: "shipped PR 42",
        source_system: "github",
        event_timestamp: ts,
        source_id: "pr-42",
        sourceAgentId: "capture",
        sourceAgentName: "Capture",
      };
      const r1 = parseResult<SnippetWriteResult>(await client.callTool({ name: "memory_write_snippet", arguments: args }));
      expect(r1.status).toBe("written");
      const r2 = parseResult<SnippetWriteResult>(await client.callTool({ name: "memory_write_snippet", arguments: args }));
      expect(r2.status).toBe("duplicate");
      expect(r2.id).toBe(r1.id);
    });
  });

  it("does not dedup when source_id is absent", async () => {
    await withServer(dbPath, async (client, dbUrl) => {
      await registerTestDomain(dbUrl, "work");
      const args = {
        snippet_type: "advanced",
        life_domain: "work",
        content: "same content, no id",
        source_system: "manual",
        event_timestamp: new Date().toISOString(),
        sourceAgentId: "capture",
        sourceAgentName: "Capture",
      };
      const r1 = parseResult<SnippetWriteResult>(await client.callTool({ name: "memory_write_snippet", arguments: args }));
      const r2 = parseResult<SnippetWriteResult>(await client.callTool({ name: "memory_write_snippet", arguments: args }));
      expect(r1.status).toBe("written");
      expect(r2.status).toBe("written");
      expect(r1.id).not.toBe(r2.id);
    });
  });

  it("applies auto-pin: goal-linked ship → active + 180d", async () => {
    await withServer(dbPath, async (client, dbUrl) => {
      await registerTestDomain(dbUrl, "work");
      const raw = await client.callTool({
        name: "memory_write_snippet",
        arguments: {
          snippet_type: "shipped",
          life_domain: "work",
          content: "shipped feature X",
          source_system: "github",
          event_timestamp: new Date().toISOString(),
          linked_goal_id: "T4",
          sourceAgentId: "capture",
          sourceAgentName: "Capture",
        },
      });
      const r = parseResult<SnippetWriteResult>(raw);
      expect(r.status).toBe("written");
      expect(r.permanence).toBe("active");
      expect(r.autoPin?.reason).toBe("goal-linked ship");

      const db = createClient({ url: dbUrl });
      const row = (await db.execute({
        sql: `SELECT permanence, expires_at FROM memories WHERE id = ?`,
        args: [r.id!],
      })).rows[0] as unknown as { permanence: string; expires_at: string };
      expect(row.permanence).toBe("active");
      const expected180d = Date.now() + 180 * 24 * 60 * 60 * 1000;
      expect(Math.abs(new Date(row.expires_at).getTime() - expected180d)).toBeLessThan(60_000);

      const events = (await db.execute({
        sql: `SELECT event_type FROM memory_events WHERE memory_id = ?`,
        args: [r.id!],
      })).rows as unknown as { event_type: string }[];
      expect(events.some((e) => e.event_type === "auto_pin")).toBe(true);
      db.close();
    });
  });

  it("applies auto-pin: meta.milestone=true → canonical + NULL expires_at", async () => {
    await withServer(dbPath, async (client, dbUrl) => {
      await registerTestDomain(dbUrl, "work");
      const raw = await client.callTool({
        name: "memory_write_snippet",
        arguments: {
          snippet_type: "advanced",
          life_domain: "work",
          content: "major milestone",
          source_system: "manual",
          event_timestamp: new Date().toISOString(),
          meta: { milestone: true },
          sourceAgentId: "capture",
          sourceAgentName: "Capture",
        },
      });
      const r = parseResult<SnippetWriteResult>(raw);
      expect(r.permanence).toBe("canonical");
      expect(r.expires_at).toBeNull();
      expect(r.autoPin?.reason).toBe("explicit milestone flag");

      const db = createClient({ url: dbUrl });
      const row = (await db.execute({
        sql: `SELECT permanence, expires_at FROM memories WHERE id = ?`,
        args: [r.id!],
      })).rows[0] as unknown as { permanence: string; expires_at: string | null };
      expect(row.permanence).toBe("canonical");
      expect(row.expires_at).toBeNull();
      db.close();
    });
  });

  it("goal-linked ship wins over milestone when both conditions match (precedence)", async () => {
    await withServer(dbPath, async (client, dbUrl) => {
      await registerTestDomain(dbUrl, "work");
      const raw = await client.callTool({
        name: "memory_write_snippet",
        arguments: {
          snippet_type: "shipped",
          life_domain: "work",
          content: "shipped and milestone",
          source_system: "github",
          event_timestamp: new Date().toISOString(),
          linked_goal_id: "T5",
          meta: { milestone: true },
          sourceAgentId: "capture",
          sourceAgentName: "Capture",
        },
      });
      const r = parseResult<SnippetWriteResult>(raw);
      expect(r.permanence).toBe("active");
      expect(r.autoPin?.reason).toBe("goal-linked ship");
    });
  });

  it("records learned_at as server time, not event_timestamp", async () => {
    await withServer(dbPath, async (client, dbUrl) => {
      await registerTestDomain(dbUrl, "work");
      const backdated = "2026-01-01T00:00:00Z";
      const before = Date.now();
      const raw = await client.callTool({
        name: "memory_write_snippet",
        arguments: {
          snippet_type: "advanced",
          life_domain: "work",
          content: "backdated event",
          source_system: "manual",
          event_timestamp: backdated,
          sourceAgentId: "capture",
          sourceAgentName: "Capture",
        },
      });
      const r = parseResult<SnippetWriteResult>(raw);
      const after = Date.now();

      const db = createClient({ url: dbUrl });
      const row = (await db.execute({
        sql: `SELECT learned_at, event_ts FROM memories WHERE id = ?`,
        args: [r.id!],
      })).rows[0] as unknown as { learned_at: string; event_ts: string };
      expect(row.event_ts).toBe(backdated);
      const learnedMs = new Date(row.learned_at).getTime();
      expect(learnedMs).toBeGreaterThanOrEqual(before - 1);
      expect(learnedMs).toBeLessThanOrEqual(after + 1);
      db.close();
    });
  });

  it("rejects non-slug life_domain", async () => {
    await withServer(dbPath, async (client) => {
      const raw = await client.callTool({
        name: "memory_write_snippet",
        arguments: {
          snippet_type: "started",
          life_domain: "Work",
          content: "x",
          source_system: "manual",
          event_timestamp: new Date().toISOString(),
          sourceAgentId: "capture",
          sourceAgentName: "Capture",
        },
      });
      const r = parseResult<SnippetWriteResult>(raw);
      expect(r.error).toMatch(/invalid/i);
    });
  });

  it("rejects meta JSON larger than 4KB", async () => {
    await withServer(dbPath, async (client, dbUrl) => {
      await registerTestDomain(dbUrl, "work");
      const bigMeta = { junk: "A".repeat(5000) };
      const raw = await client.callTool({
        name: "memory_write_snippet",
        arguments: {
          snippet_type: "advanced",
          life_domain: "work",
          content: "too big",
          source_system: "manual",
          event_timestamp: new Date().toISOString(),
          meta: bigMeta,
          sourceAgentId: "capture",
          sourceAgentName: "Capture",
        },
      });
      const r = parseResult<SnippetWriteResult>(raw);
      expect(r.error).toBe("meta_too_large");
    });
  });

  it("returns the slug-validation error before the permission error for a bad domain name", async () => {
    await withServer(dbPath, async (client, dbUrl) => {
      // Block the agent on the literal domain "Bad Name" just to prove slug
      // validation fires first; also seed the slug-valid domain so the write
      // path clears up to the permission check for it.
      const db = createClient({ url: dbUrl });
      await db.execute({
        sql: `INSERT INTO agent_permissions (agent_id, domain, can_read, can_write) VALUES (?, ?, 1, 0)`,
        args: ["locked-agent", "Bad Name"],
      });
      db.close();

      const raw = await client.callTool({
        name: "memory_write_snippet",
        arguments: {
          snippet_type: "advanced",
          life_domain: "Bad Name",
          content: "x",
          source_system: "manual",
          event_timestamp: new Date().toISOString(),
          sourceAgentId: "locked-agent",
          sourceAgentName: "Locked",
        },
      });
      const r = parseResult<SnippetWriteResult>(raw);
      expect(r.error).toMatch(/invalid/i);
      expect(r.error).not.toMatch(/not allowed to write/i);
    });
  });

  it("enforces rate limit unconditionally (501st rejected even with fresh source_id)", async () => {
    // This test is heavy (~505 writes). Use an isolated DB but limit volume.
    await withServer(dbPath, async (client, dbUrl) => {
      await registerTestDomain(dbUrl, "work");
      // Pre-load 500 snippet rows for this (agent, domain) within the last hour via direct SQL to skip the tool path
      const db = createClient({ url: dbUrl });
      const baseTs = new Date().toISOString();
      const stmts = [];
      for (let i = 0; i < 500; i++) {
        stmts.push({
          sql: `INSERT INTO memories (id, content, domain, source_agent_id, source_agent_name, source_type, confidence, learned_at, entity_type, structured_data, permanence, expires_at)
                VALUES (?, ?, 'work', 'cap', 'Cap', 'observed', 1.0, datetime('now'), 'snippet', ?, 'ephemeral', datetime('now','+60 day'))`,
          args: [randomBytes(16).toString("hex"), `preload #${i}`, JSON.stringify({ snippet_type: "advanced", life_domain: "work", source_system: "manual", event_timestamp: baseTs })],
        });
      }
      await db.batch(stmts, "write");
      db.close();

      // 501st call (tool path) — should be rejected with fresh source_id
      const raw = await client.callTool({
        name: "memory_write_snippet",
        arguments: {
          snippet_type: "advanced",
          life_domain: "work",
          content: "should be rate-capped",
          source_system: "manual",
          event_timestamp: new Date().toISOString(),
          source_id: randomBytes(8).toString("hex"),
          sourceAgentId: "cap",
          sourceAgentName: "Cap",
        },
      });
      const r = parseResult<SnippetWriteResult>(raw);
      expect(r.error).toBe("snippet_rate_cap_exceeded");
    });
  });
});
