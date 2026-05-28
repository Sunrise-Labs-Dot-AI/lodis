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
  return resolve(tmpdir(), `lodis-scope-${randomBytes(8).toString("hex")}.db`);
}

interface ToolResult {
  content: Array<{ type: string; text: string }>;
}
function parseResult<T>(raw: unknown): T {
  return JSON.parse((raw as ToolResult).content[0].text) as T;
}
function rawText(raw: unknown): string {
  return (raw as ToolResult).content[0].text;
}

async function withServer<T>(
  dbPath: string,
  fn: (client: McpClient, dbUrl: string) => Promise<T>,
): Promise<T> {
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  const dbUrl = "file:" + dbPath;
  await startServer({ transport: serverTransport, dbUrl });
  const client = new McpClient({ name: "scope-test", version: "0.0.0" }, { capabilities: {} });
  await client.connect(clientTransport);
  try {
    return await fn(client, dbUrl);
  } finally {
    await client.close();
  }
}

type SeedOpts = { domain?: string; entityType?: string | null; entityName?: string | null };
async function seed(
  db: ReturnType<typeof createClient>,
  id: string,
  content: string,
  opts: SeedOpts = {},
) {
  await db.execute({
    sql: `INSERT INTO memories (id, content, domain, source_agent_id, source_agent_name, source_type, confidence, learned_at, entity_type, entity_name)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      content,
      opts.domain ?? "general",
      "seed",
      "Seed",
      "stated",
      0.9,
      new Date().toISOString(),
      opts.entityType ?? null,
      opts.entityName ?? null,
    ],
  });
}

describe("memory_search/context scope partition (Phase 4 noise)", () => {
  let dbPath: string;
  let savedRerankerDisabled: string | undefined;

  beforeEach(() => {
    dbPath = tempDbPath();
    // Keep contextSearch off the cross-encoder so tests don't load a model.
    savedRerankerDisabled = process.env.LODIS_RERANKER_DISABLED;
    process.env.LODIS_RERANKER_DISABLED = "1";
  });
  afterEach(() => {
    if (savedRerankerDisabled === undefined) delete process.env.LODIS_RERANKER_DISABLED;
    else process.env.LODIS_RERANKER_DISABLED = savedRerankerDisabled;
    try {
      for (const s of ["", "-wal", "-shm"]) {
        const p = dbPath + s;
        if (existsSync(p)) unlinkSync(p);
      }
    } catch {
      // best-effort
    }
  });

  it("hides snippets from default search; scope:'all' and explicit entityType surface them", async () => {
    await withServer(dbPath, async (client, dbUrl) => {
      const db = createClient({ url: dbUrl });
      const snippetId = randomBytes(16).toString("hex");
      const factId = randomBytes(16).toString("hex");
      await seed(db, snippetId, "Progress shipped the track timer feature", { domain: "fitness", entityType: "snippet", entityName: "Progress: Fitness" });
      await seed(db, factId, "James trains on the track every morning", { domain: "fitness", entityType: "routine" });
      db.close();

      // Default scope excludes the snippet, keeps the normal memory.
      const def = parseResult<{ memories: Array<{ id: string }> }>(
        await client.callTool({ name: "memory_search", arguments: { query: "track" } }),
      );
      const defIds = def.memories.map((m) => m.id);
      expect(defIds).toContain(factId);
      expect(defIds).not.toContain(snippetId);

      // scope:'all' includes the snippet.
      const all = parseResult<{ memories: Array<{ id: string }> }>(
        await client.callTool({ name: "memory_search", arguments: { query: "track", scope: "all" } }),
      );
      expect(all.memories.map((m) => m.id)).toContain(snippetId);

      // Explicit entityType filter overrides the partition even at default scope.
      const typed = parseResult<{ memories: Array<{ id: string }> }>(
        await client.callTool({ name: "memory_search", arguments: { query: "track", entityType: "snippet" } }),
      );
      expect(typed.memories.map((m) => m.id)).toContain(snippetId);
    });
  });

  it("hides archived-domain rows from default search after memory_archive_domain; scope:'all' and explicit domain surface them", async () => {
    await withServer(dbPath, async (client, dbUrl) => {
      const db = createClient({ url: dbUrl });
      const contactId = randomBytes(16).toString("hex");
      const workId = randomBytes(16).toString("hex");
      await seed(db, contactId, "Sarah Chen contact pointer", { domain: "contacts", entityType: "person", entityName: "Sarah Chen" });
      await seed(db, workId, "Met Sarah Chen at the AI conference", { domain: "work", entityType: "event" });
      db.close();

      const idsFor = async (args: Record<string, unknown>) =>
        parseResult<{ memories: Array<{ id: string }> }>(
          await client.callTool({ name: "memory_search", arguments: { query: "Chen", ...args } }),
        ).memories.map((m) => m.id);

      // Before archiving, contacts are NOT excluded — archiving is the lever.
      expect(await idsFor({})).toContain(contactId);

      // Register then archive the contacts domain.
      await client.callTool({ name: "memory_register_domain", arguments: { name: "contacts", sourceAgentId: "t", sourceAgentName: "T" } });
      const arch = parseResult<{ status: string }>(
        await client.callTool({ name: "memory_archive_domain", arguments: { name: "contacts", sourceAgentId: "t", sourceAgentName: "T" } }),
      );
      expect(arch.status).toBe("archived");

      // Default scope now drops the contact, keeps the real memory.
      const def = await idsFor({});
      expect(def).toContain(workId);
      expect(def).not.toContain(contactId);

      // scope:'all' includes the archived-domain row.
      expect(await idsFor({ scope: "all" })).toContain(contactId);

      // Explicit domain filter overrides the partition even at default scope.
      expect(await idsFor({ domain: "contacts" })).toContain(contactId);
    });
  });

  it("memory_context honors the snippet partition", async () => {
    await withServer(dbPath, async (client, dbUrl) => {
      const db = createClient({ url: dbUrl });
      const snippetId = randomBytes(16).toString("hex");
      const factId = randomBytes(16).toString("hex");
      // Distinctive token proves presence/absence in the packed output.
      await seed(db, snippetId, "Progress zephyrtoken shipped milestone", { domain: "fitness", entityType: "snippet", entityName: "Progress: Fitness" });
      await seed(db, factId, "James notes zephyrtoken in his training log", { domain: "fitness", entityType: "routine" });
      db.close();

      const def = rawText(await client.callTool({ name: "memory_context", arguments: { query: "zephyrtoken", token_budget: 2000 } }));
      expect(def).toContain(factId);
      expect(def).not.toContain(snippetId);

      const all = rawText(await client.callTool({ name: "memory_context", arguments: { query: "zephyrtoken", token_budget: 2000, scope: "all" } }));
      expect(all).toContain(snippetId);
    });
  });

  it("memory_write_snippet connections[] bridge a snippet to a durable entity", async () => {
    await withServer(dbPath, async (client, dbUrl) => {
      const db = createClient({ url: dbUrl });
      const orgId = randomBytes(16).toString("hex");
      await seed(db, orgId, "Acme Corp is a target company", { domain: "work", entityType: "organization", entityName: "Acme Corp" });

      // life_domain must be registered before a snippet can be written to it.
      await client.callTool({ name: "memory_register_domain", arguments: { name: "work", sourceAgentId: "t", sourceAgentName: "T" } });

      const res = parseResult<{ status: string; id: string; connections_result?: { applied: number; dropped: unknown[] } }>(
        await client.callTool({
          name: "memory_write_snippet",
          arguments: {
            snippet_type: "shipped",
            life_domain: "work",
            content: "shipped the Acme integration",
            source_system: "manual",
            event_timestamp: new Date().toISOString(),
            connections: [{ targetEntityName: "Acme Corp", relationship: "about" }],
            sourceAgentId: "t",
            sourceAgentName: "T",
          },
        }),
      );
      expect(res.status).toBe("written");
      expect(res.connections_result?.applied).toBe(1);
      expect(res.connections_result?.dropped ?? []).toHaveLength(0);

      // The bridge edge exists: snippet --about--> org.
      const edge = (await db.execute({
        sql: `SELECT relationship FROM memory_connections WHERE source_memory_id = ? AND target_memory_id = ?`,
        args: [res.id, orgId],
      })).rows[0];
      expect(edge?.relationship).toBe("about");
      db.close();
    });
  });
});
