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
  return resolve(tmpdir(), `lodis-domain-tools-${randomBytes(8).toString("hex")}.db`);
}

interface ToolResult { content: Array<{ type: string; text: string }>; }
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
  const client = new McpClient({ name: "domain-tools-test", version: "0.0.0" }, { capabilities: {} });
  await client.connect(clientTransport);
  try { return await fn(client, dbUrl); } finally { await client.close(); }
}

describe("domain admin tools", () => {
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

  it("memory_register_domain creates a new domain", async () => {
    await withServer(dbPath, async (client) => {
      const r = parseResult<{ status: string; name: string; archived: boolean }>(
        await client.callTool({
          name: "memory_register_domain",
          arguments: { name: "advisory", sourceAgentId: "a", sourceAgentName: "A" },
        }),
      );
      expect(r.status).toBe("created");
      expect(r.name).toBe("advisory");
      expect(r.archived).toBe(false);
    });
  });

  it("memory_register_domain is idempotent on duplicates", async () => {
    await withServer(dbPath, async (client) => {
      await client.callTool({
        name: "memory_register_domain",
        arguments: { name: "work", sourceAgentId: "a", sourceAgentName: "A" },
      });
      const r = parseResult<{ status: string }>(
        await client.callTool({
          name: "memory_register_domain",
          arguments: { name: "work", sourceAgentId: "a", sourceAgentName: "A" },
        }),
      );
      expect(r.status).toBe("noop");
    });
  });

  it("memory_archive_domain archives, then memory_write_snippet rejects, then re-register unarchives", async () => {
    await withServer(dbPath, async (client) => {
      await client.callTool({
        name: "memory_register_domain",
        arguments: { name: "atlas", sourceAgentId: "a", sourceAgentName: "A" },
      });
      const arc = parseResult<{ status: string }>(
        await client.callTool({
          name: "memory_archive_domain",
          arguments: { name: "atlas", reason: "test archive", sourceAgentId: "a", sourceAgentName: "A" },
        }),
      );
      expect(arc.status).toBe("archived");

      const blocked = parseResult<{ error?: string }>(
        await client.callTool({
          name: "memory_write_snippet",
          arguments: {
            snippet_type: "advanced", life_domain: "atlas", content: "x",
            source_system: "manual", event_timestamp: new Date().toISOString(),
            sourceAgentId: "a", sourceAgentName: "A",
          },
        }),
      );
      expect(blocked.error).toBe("domain_archived");

      const unarc = parseResult<{ status: string }>(
        await client.callTool({
          name: "memory_register_domain",
          arguments: { name: "atlas", sourceAgentId: "a", sourceAgentName: "A" },
        }),
      );
      expect(unarc.status).toBe("unarchived");

      const ok = parseResult<{ status: string }>(
        await client.callTool({
          name: "memory_write_snippet",
          arguments: {
            snippet_type: "advanced", life_domain: "atlas", content: "y",
            source_system: "manual", event_timestamp: new Date().toISOString(),
            sourceAgentId: "a", sourceAgentName: "A",
          },
        }),
      );
      expect(ok.status).toBe("written");
    });
  });

  it("memory_register_domain rejects invalid names", async () => {
    await withServer(dbPath, async (client) => {
      const r = parseResult<{ error?: string }>(
        await client.callTool({
          name: "memory_register_domain",
          arguments: { name: "BadName", sourceAgentId: "a", sourceAgentName: "A" },
        }),
      );
      expect(r.error).toMatch(/invalid/i);
    });
  });

  it("memory_register_domain validates parent_name exists", async () => {
    await withServer(dbPath, async (client) => {
      const r = parseResult<{ error?: string }>(
        await client.callTool({
          name: "memory_register_domain",
          arguments: { name: "child", parent_name: "nonexistent", sourceAgentId: "a", sourceAgentName: "A" },
        }),
      );
      expect(r.error).toMatch(/does not exist/i);
    });
  });

  it("memory_archive_domain with unknown name returns noop", async () => {
    await withServer(dbPath, async (client) => {
      const r = parseResult<{ status: string }>(
        await client.callTool({
          name: "memory_archive_domain",
          arguments: { name: "never-existed", sourceAgentId: "a", sourceAgentName: "A" },
        }),
      );
      expect(r.status).toBe("noop");
    });
  });

  it("D13: agent without write permission on domain cannot archive it", async () => {
    await withServer(dbPath, async (client, dbUrl) => {
      // Seed domain + deny the agent on this domain.
      const db = createClient({ url: dbUrl });
      await db.execute({
        sql: `INSERT INTO domains (name, created_at) VALUES (?, datetime('now'))`,
        args: ["health"],
      });
      await db.execute({
        sql: `INSERT INTO agent_permissions (agent_id, domain, can_read, can_write) VALUES (?, ?, 1, 0)`,
        args: ["readonly-agent", "health"],
      });
      db.close();

      const r = parseResult<{ error?: string }>(
        await client.callTool({
          name: "memory_archive_domain",
          arguments: { name: "health", sourceAgentId: "readonly-agent", sourceAgentName: "RO" },
        }),
      );
      expect(r.error).toMatch(/not allowed to write/i);

      // Verify the domain is still un-archived.
      const chk = createClient({ url: dbUrl });
      const row = (await chk.execute({
        sql: `SELECT archived FROM domains WHERE name = ?`,
        args: ["health"],
      })).rows[0] as unknown as { archived: number };
      expect(row.archived).toBe(0);
      chk.close();
    });
  });
});

describe("memory_list_domains", () => {
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

  it("returns domain+count fields preserved for backward compat", async () => {
    await withServer(dbPath, async (client, dbUrl) => {
      const db = createClient({ url: dbUrl });
      await db.execute({
        sql: `INSERT INTO memories (id, content, domain, source_agent_id, source_agent_name, source_type, confidence, learned_at) VALUES (?, 'hi', 'work', 'x', 'X', 'observed', 1, datetime('now'))`,
        args: [randomBytes(16).toString("hex")],
      });
      db.close();

      const r = parseResult<{ domains: Array<{ domain: string; count: number; registered: boolean; archived: boolean }> }>(
        await client.callTool({ name: "memory_list_domains", arguments: {} }),
      );
      const work = r.domains.find((d) => d.domain === "work");
      expect(work).toBeTruthy();
      expect(work!.count).toBe(1);
      // New fields present (but optional for old callers)
      expect(work!.registered).toBeDefined();
      expect(work!.archived).toBeDefined();
    });
  });

  it("excludes archived domains by default, includes them with include_archived=true", async () => {
    await withServer(dbPath, async (client, dbUrl) => {
      const db = createClient({ url: dbUrl });
      await db.execute({
        sql: `INSERT INTO domains (name, archived, archived_at, created_at) VALUES ('work', 0, NULL, datetime('now')),
                                                                                    ('retired', 1, datetime('now'), datetime('now'))`,
        args: [],
      });
      db.close();

      const def = parseResult<{ domains: Array<{ domain: string; archived: boolean }> }>(
        await client.callTool({ name: "memory_list_domains", arguments: {} }),
      );
      expect(def.domains.find((d) => d.domain === "retired")).toBeUndefined();

      const incl = parseResult<{ domains: Array<{ domain: string; archived: boolean }> }>(
        await client.callTool({ name: "memory_list_domains", arguments: { include_archived: true } }),
      );
      const ret = incl.domains.find((d) => d.domain === "retired");
      expect(ret?.archived).toBe(true);
    });
  });

  it("surfaces orphan domains (unregistered, present in memories)", async () => {
    await withServer(dbPath, async (client, dbUrl) => {
      const db = createClient({ url: dbUrl });
      await db.execute({
        sql: `INSERT INTO memories (id, content, domain, source_agent_id, source_agent_name, source_type, confidence, learned_at) VALUES (?, 'hi', 'Legacy/Casing', 'x', 'X', 'observed', 1, datetime('now'))`,
        args: [randomBytes(16).toString("hex")],
      });
      db.close();

      const r = parseResult<{ domains: Array<{ domain: string; count: number; registered: boolean }> }>(
        await client.callTool({ name: "memory_list_domains", arguments: {} }),
      );
      const orphan = r.domains.find((d) => d.domain === "Legacy/Casing");
      expect(orphan).toBeTruthy();
      expect(orphan!.registered).toBe(false);
      expect(orphan!.count).toBe(1);
    });
  });
});
