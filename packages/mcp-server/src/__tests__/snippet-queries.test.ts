import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { resolve } from "path";
import { randomBytes } from "crypto";
import { Client as McpClient } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createClient, type Client } from "@libsql/client";
import { startServer } from "../server.js";

function tempDbPath(): string {
  return resolve(tmpdir(), `lodis-snippet-queries-${randomBytes(8).toString("hex")}.db`);
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
  const client = new McpClient({ name: "query-test", version: "0.0.0" }, { capabilities: {} });
  await client.connect(clientTransport);
  try { return await fn(client, dbUrl); } finally { await client.close(); }
}

interface InsertSnippetArgs {
  domain: string;
  event_ts: string;
  snippet_type: string;
  linked_goal_id?: string;
  content?: string;
}

async function insertSnippet(db: Client, args: InsertSnippetArgs): Promise<string> {
  const id = randomBytes(16).toString("hex");
  const structured = {
    snippet_type: args.snippet_type,
    life_domain: args.domain,
    source_system: "test",
    event_timestamp: args.event_ts,
    ...(args.linked_goal_id !== undefined && { linked_goal_id: args.linked_goal_id }),
  };
  await db.execute({
    sql: `INSERT INTO memories (id, content, domain, source_agent_id, source_agent_name, source_type, confidence, learned_at, event_ts, entity_type, entity_name, structured_data, permanence, expires_at)
          VALUES (?, ?, ?, 'cap', 'Cap', 'observed', 1.0, datetime('now'), ?, 'snippet', ?, ?, 'ephemeral', datetime('now','+60 day'))`,
    args: [
      id,
      args.content ?? `${args.snippet_type} in ${args.domain}`,
      args.domain,
      args.event_ts,
      `Progress: ${args.domain}`,
      JSON.stringify(structured),
    ],
  });
  return id;
}

async function registerDomains(db: Client, names: string[]): Promise<void> {
  for (const n of names) {
    await db.execute({
      sql: `INSERT OR IGNORE INTO domains (name, created_at) VALUES (?, datetime('now'))`,
      args: [n],
    });
  }
}

describe("memory_query_progress", () => {
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

  it("returns newest-first rows for the given window", async () => {
    await withServer(dbPath, async (client, dbUrl) => {
      const db = createClient({ url: dbUrl });
      await registerDomains(db, ["work", "fitness", "learning"]);
      const now = Date.now();
      for (let i = 0; i < 10; i++) {
        await insertSnippet(db, {
          domain: ["work", "fitness", "learning"][i % 3],
          event_ts: new Date(now - i * 24 * 60 * 60 * 1000).toISOString(),
          snippet_type: "advanced",
        });
      }
      db.close();

      const raw = await client.callTool({
        name: "memory_query_progress",
        arguments: {
          date_from: new Date(now - 7 * 24 * 60 * 60 * 1000 + 1000).toISOString(),
          date_to: new Date(now + 60_000).toISOString(),
        },
      });
      const r = parseResult<{ snippets: Array<{ id: string; event_timestamp: string; life_domain: string }>; count: number }>(raw);
      expect(r.count).toBeLessThanOrEqual(8);
      expect(r.count).toBeGreaterThanOrEqual(7);
      // Strictly newest-first
      for (let i = 1; i < r.snippets.length; i++) {
        expect(new Date(r.snippets[i - 1].event_timestamp).getTime())
          .toBeGreaterThanOrEqual(new Date(r.snippets[i].event_timestamp).getTime());
      }
    });
  });

  it("filters by life_domain, linked_goal_id, snippet_type", async () => {
    await withServer(dbPath, async (client, dbUrl) => {
      const db = createClient({ url: dbUrl });
      await registerDomains(db, ["work", "fitness"]);
      const now = new Date().toISOString();
      await insertSnippet(db, { domain: "work", event_ts: now, snippet_type: "shipped", linked_goal_id: "T1" });
      await insertSnippet(db, { domain: "work", event_ts: now, snippet_type: "advanced", linked_goal_id: "T1" });
      await insertSnippet(db, { domain: "fitness", event_ts: now, snippet_type: "shipped", linked_goal_id: "T2" });
      db.close();

      const from = new Date(Date.now() - 60_000).toISOString();
      const to = new Date(Date.now() + 60_000).toISOString();

      const byDomain = parseResult<{ count: number }>(
        await client.callTool({ name: "memory_query_progress", arguments: { date_from: from, date_to: to, life_domain: "work" } }),
      );
      expect(byDomain.count).toBe(2);

      const byGoal = parseResult<{ count: number }>(
        await client.callTool({ name: "memory_query_progress", arguments: { date_from: from, date_to: to, linked_goal_id: "T1" } }),
      );
      expect(byGoal.count).toBe(2);

      const byType = parseResult<{ count: number }>(
        await client.callTool({ name: "memory_query_progress", arguments: { date_from: from, date_to: to, snippet_type: "shipped" } }),
      );
      expect(byType.count).toBe(2);
    });
  });

  it("excludes archived-domain snippets by default, includes them when include_archived_domains=true", async () => {
    await withServer(dbPath, async (client, dbUrl) => {
      const db = createClient({ url: dbUrl });
      await registerDomains(db, ["work", "atlas"]);
      const now = new Date().toISOString();
      await insertSnippet(db, { domain: "work", event_ts: now, snippet_type: "advanced" });
      await insertSnippet(db, { domain: "atlas", event_ts: now, snippet_type: "advanced" });
      await db.execute({ sql: `UPDATE domains SET archived = 1, archived_at = datetime('now') WHERE name = 'atlas'`, args: [] });
      db.close();

      const from = new Date(Date.now() - 60_000).toISOString();
      const to = new Date(Date.now() + 60_000).toISOString();

      const def = parseResult<{ snippets: Array<{ life_domain: string }>; count: number }>(
        await client.callTool({ name: "memory_query_progress", arguments: { date_from: from, date_to: to } }),
      );
      expect(def.snippets.every((s) => s.life_domain !== "atlas")).toBe(true);

      const incl = parseResult<{ snippets: Array<{ life_domain: string }>; count: number }>(
        await client.callTool({ name: "memory_query_progress", arguments: { date_from: from, date_to: to, include_archived_domains: true } }),
      );
      expect(incl.snippets.some((s) => s.life_domain === "atlas")).toBe(true);
    });
  });

  it("rejects windows wider than 366 days", async () => {
    await withServer(dbPath, async (client) => {
      const r = parseResult<{ error?: string }>(
        await client.callTool({
          name: "memory_query_progress",
          arguments: {
            date_from: "2023-01-01T00:00:00Z",
            date_to: "2026-04-24T00:00:00Z",
          },
        }),
      );
      expect(r.error).toMatch(/Query window too large/);
    });
  });

  it("response shape omits structured_data and includes url", async () => {
    await withServer(dbPath, async (client, dbUrl) => {
      const db = createClient({ url: dbUrl });
      await registerDomains(db, ["work"]);
      await insertSnippet(db, { domain: "work", event_ts: new Date().toISOString(), snippet_type: "shipped", linked_goal_id: "T1" });
      db.close();

      const r = parseResult<{ snippets: Array<Record<string, unknown>> }>(
        await client.callTool({
          name: "memory_query_progress",
          arguments: {
            date_from: new Date(Date.now() - 60_000).toISOString(),
            date_to: new Date(Date.now() + 60_000).toISOString(),
          },
        }),
      );
      expect(r.snippets[0]).not.toHaveProperty("structured_data");
      expect(r.snippets[0]).toHaveProperty("url");
      expect(r.snippets[0]).toHaveProperty("snippet_type", "shipped");
      expect(r.snippets[0]).toHaveProperty("linked_goal_id", "T1");
    });
  });

  it("respects limit", async () => {
    await withServer(dbPath, async (client, dbUrl) => {
      const db = createClient({ url: dbUrl });
      await registerDomains(db, ["work"]);
      const baseMs = Date.now();
      for (let i = 0; i < 10; i++) {
        await insertSnippet(db, {
          domain: "work",
          event_ts: new Date(baseMs - i * 1000).toISOString(),
          snippet_type: "advanced",
        });
      }
      db.close();

      const r = parseResult<{ count: number; snippets: Array<{ event_timestamp: string }> }>(
        await client.callTool({
          name: "memory_query_progress",
          arguments: {
            date_from: new Date(baseMs - 60_000).toISOString(),
            date_to: new Date(baseMs + 60_000).toISOString(),
            limit: 5,
          },
        }),
      );
      expect(r.count).toBe(5);
    });
  });
});

describe("memory_progress_summary", () => {
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

  it("rolls up 20 snippets across 3 domains, 3 goals, 4 types (2 stalled)", async () => {
    await withServer(dbPath, async (client, dbUrl) => {
      const db = createClient({ url: dbUrl });
      await registerDomains(db, ["work", "fitness", "learning"]);
      const baseMs = Date.now();
      const domains = ["work", "fitness", "learning"];
      const goals = ["T1", "T2", "T3"];
      const types = ["shipped", "advanced", "started", "stalled"];
      let stalledCount = 0;
      for (let i = 0; i < 20; i++) {
        const type = stalledCount < 2 && i % 9 === 0 ? "stalled" : types[i % types.length];
        if (type === "stalled") stalledCount++;
        await insertSnippet(db, {
          domain: domains[i % 3],
          event_ts: new Date(baseMs - i * 1000).toISOString(),
          snippet_type: type,
          linked_goal_id: goals[i % 3],
        });
      }
      db.close();

      const r = parseResult<{
        total: number;
        by_life_domain: Record<string, number>;
        by_snippet_type: Record<string, number>;
        by_goal: Record<string, { count: number; top_snippets: unknown[] }>;
        stalled: unknown[];
        date_range: { from: string; to: string };
      }>(await client.callTool({
        name: "memory_progress_summary",
        arguments: {
          date_from: new Date(baseMs - 60_000).toISOString(),
          date_to: new Date(baseMs + 60_000).toISOString(),
        },
      }));

      expect(r.total).toBe(20);
      expect(Object.values(r.by_life_domain).reduce((a, b) => a + b, 0)).toBe(20);
      expect(r.by_snippet_type).toHaveProperty("shipped");
      expect(r.by_snippet_type).toHaveProperty("blocked");
      expect(r.by_snippet_type.blocked).toBe(0); // zero-count key present
      expect(r.stalled.length).toBe(r.by_snippet_type.stalled);
      expect(Object.keys(r.by_goal).sort()).toEqual(["T1", "T2", "T3"]);
      for (const g of Object.values(r.by_goal)) {
        expect(g.top_snippets.length).toBeLessThanOrEqual(3);
      }
    });
  });

  it("life_domains filter restricts to named domains only", async () => {
    await withServer(dbPath, async (client, dbUrl) => {
      const db = createClient({ url: dbUrl });
      await registerDomains(db, ["atlas", "fitness"]);
      const now = new Date().toISOString();
      await insertSnippet(db, { domain: "atlas", event_ts: now, snippet_type: "advanced" });
      await insertSnippet(db, { domain: "fitness", event_ts: now, snippet_type: "advanced" });
      db.close();

      const r = parseResult<{
        total: number;
        by_life_domain: Record<string, number>;
      }>(await client.callTool({
        name: "memory_progress_summary",
        arguments: {
          date_from: new Date(Date.now() - 60_000).toISOString(),
          date_to: new Date(Date.now() + 60_000).toISOString(),
          life_domains: ["atlas"],
        },
      }));
      expect(r.total).toBe(1);
      expect(r.by_life_domain).toEqual({ atlas: 1 });
    });
  });

  it("top_per_goal=1 returns at most one top_snippet per goal", async () => {
    await withServer(dbPath, async (client, dbUrl) => {
      const db = createClient({ url: dbUrl });
      await registerDomains(db, ["work"]);
      const base = Date.now();
      for (let i = 0; i < 5; i++) {
        await insertSnippet(db, {
          domain: "work",
          event_ts: new Date(base - i * 1000).toISOString(),
          snippet_type: "advanced",
          linked_goal_id: "T1",
        });
      }
      db.close();

      const r = parseResult<{
        by_goal: Record<string, { count: number; top_snippets: unknown[] }>;
      }>(await client.callTool({
        name: "memory_progress_summary",
        arguments: {
          date_from: new Date(base - 60_000).toISOString(),
          date_to: new Date(base + 60_000).toISOString(),
          top_per_goal: 1,
        },
      }));
      expect(r.by_goal.T1.count).toBe(5);
      expect(r.by_goal.T1.top_snippets.length).toBe(1);
    });
  });

  it("sets truncated=true when the window contains more than the scan limit", async () => {
    await withServer(dbPath, async (client, dbUrl) => {
      const db = createClient({ url: dbUrl });
      await registerDomains(db, ["work"]);
      const base = Date.now();
      const stmts = [] as { sql: string; args: (string | number)[] }[];
      const nowIso = new Date().toISOString();
      // 1005 rows > 1000-row scan limit; all in the same window.
      for (let i = 0; i < 1005; i++) {
        stmts.push({
          sql: `INSERT INTO memories (id, content, domain, source_agent_id, source_agent_name, source_type, confidence, learned_at, event_ts, entity_type, entity_name, structured_data, permanence, expires_at)
                VALUES (?, ?, 'work', 'cap', 'Cap', 'observed', 1.0, ?, ?, 'snippet', 'Progress: Work', ?, 'ephemeral', datetime('now','+60 day'))`,
          args: [
            randomBytes(16).toString("hex"),
            `row ${i}`,
            nowIso,
            new Date(base - i * 1000).toISOString(),
            JSON.stringify({ snippet_type: "advanced", life_domain: "work", source_system: "test", event_timestamp: new Date(base - i * 1000).toISOString() }),
          ],
        });
      }
      await db.batch(stmts, "write");
      db.close();

      const r = parseResult<{ total: number; truncated: boolean; scan_limit: number }>(
        await client.callTool({
          name: "memory_progress_summary",
          arguments: {
            date_from: new Date(base - 2 * 60 * 60 * 1000).toISOString(),
            date_to: new Date(base + 60_000).toISOString(),
          },
        }),
      );
      expect(r.total).toBe(1000);
      expect(r.truncated).toBe(true);
      expect(r.scan_limit).toBe(1000);
    });
  });

  it("life_domains filter is applied in SQL so the scan cap cannot be consumed by out-of-scope rows", async () => {
    await withServer(dbPath, async (client, dbUrl) => {
      const db = createClient({ url: dbUrl });
      await registerDomains(db, ["atlas", "work"]);
      const now = Date.now();
      // 3 atlas rows (the target) + 10 work rows that would otherwise dominate.
      for (let i = 0; i < 10; i++) {
        await insertSnippet(db, {
          domain: "work",
          event_ts: new Date(now - i * 1000).toISOString(),
          snippet_type: "advanced",
        });
      }
      for (let i = 0; i < 3; i++) {
        await insertSnippet(db, {
          domain: "atlas",
          event_ts: new Date(now - 20_000 - i * 1000).toISOString(),
          snippet_type: "advanced",
        });
      }
      db.close();

      const r = parseResult<{ total: number; by_life_domain: Record<string, number> }>(
        await client.callTool({
          name: "memory_progress_summary",
          arguments: {
            date_from: new Date(now - 60_000).toISOString(),
            date_to: new Date(now + 60_000).toISOString(),
            life_domains: ["atlas"],
          },
        }),
      );
      expect(r.total).toBe(3);
      expect(r.by_life_domain).toEqual({ atlas: 3 });
    });
  });

  it("include_archived_domains=true counts snippets tagged to an archived domain", async () => {
    await withServer(dbPath, async (client, dbUrl) => {
      const db = createClient({ url: dbUrl });
      await registerDomains(db, ["atlas"]);
      await insertSnippet(db, { domain: "atlas", event_ts: new Date().toISOString(), snippet_type: "stalled" });
      await db.execute({ sql: `UPDATE domains SET archived = 1, archived_at = datetime('now') WHERE name = 'atlas'`, args: [] });
      db.close();

      const def = parseResult<{ total: number }>(
        await client.callTool({
          name: "memory_progress_summary",
          arguments: {
            date_from: new Date(Date.now() - 60_000).toISOString(),
            date_to: new Date(Date.now() + 60_000).toISOString(),
          },
        }),
      );
      expect(def.total).toBe(0);

      const incl = parseResult<{ total: number }>(
        await client.callTool({
          name: "memory_progress_summary",
          arguments: {
            date_from: new Date(Date.now() - 60_000).toISOString(),
            date_to: new Date(Date.now() + 60_000).toISOString(),
            include_archived_domains: true,
          },
        }),
      );
      expect(incl.total).toBe(1);
    });
  });

  it("returns a clean empty response for an empty window", async () => {
    await withServer(dbPath, async (client) => {
      const r = parseResult<{
        total: number;
        by_life_domain: Record<string, number>;
        by_snippet_type: Record<string, number>;
        by_goal: Record<string, unknown>;
        stalled: unknown[];
      }>(await client.callTool({
        name: "memory_progress_summary",
        arguments: {
          date_from: "2020-01-01T00:00:00Z",
          date_to: "2020-01-02T00:00:00Z",
        },
      }));
      expect(r.total).toBe(0);
      expect(r.by_life_domain).toEqual({});
      expect(r.by_snippet_type.shipped).toBe(0);
      expect(r.by_goal).toEqual({});
      expect(r.stalled).toEqual([]);
    });
  });
});
