import { describe, it, expect, vi, afterEach } from "vitest";
import { existsSync, unlinkSync } from "fs";
import { resolve } from "path";
import { tmpdir } from "os";
import { randomBytes } from "crypto";
import { createClient, type Client } from "@libsql/client";
import { ensureUniqueConnectionIndex } from "../db.js";

describe("ensureUniqueConnectionIndex — branch selection (mocked)", () => {
  it("uses client.batch with mode 'write' on remote URLs", async () => {
    const batch = vi.fn().mockResolvedValue([]);
    const executeMultiple = vi.fn();
    const client = { batch, executeMultiple } as unknown as Client;

    await ensureUniqueConnectionIndex(client, true);

    expect(batch).toHaveBeenCalledTimes(1);
    expect(executeMultiple).not.toHaveBeenCalled();

    const [stmts, mode] = batch.mock.calls[0];
    expect(mode).toBe("write");
    expect(Array.isArray(stmts)).toBe(true);
    expect(stmts).toHaveLength(2);
    expect(stmts[0]).toMatch(/DELETE FROM memory_connections/);
    expect(stmts[0]).toMatch(/GROUP BY source_memory_id, target_memory_id, relationship/);
    expect(stmts[1]).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_connections_unique/,
    );
  });

  it("uses executeMultiple with BEGIN IMMEDIATE on local file URLs", async () => {
    const batch = vi.fn();
    const executeMultiple = vi.fn().mockResolvedValue(undefined);
    const client = { batch, executeMultiple } as unknown as Client;

    await ensureUniqueConnectionIndex(client, false);

    expect(executeMultiple).toHaveBeenCalledTimes(1);
    expect(batch).not.toHaveBeenCalled();

    const sql = executeMultiple.mock.calls[0][0] as string;
    expect(sql).toMatch(/BEGIN IMMEDIATE/);
    expect(sql).toMatch(/DELETE FROM memory_connections/);
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_connections_unique/);
    expect(sql).toMatch(/COMMIT/);
  });

  it("throws when isRemote=true but client.batch is missing", async () => {
    const executeMultiple = vi.fn();
    const client = { executeMultiple } as unknown as Client;

    await expect(ensureUniqueConnectionIndex(client, true)).rejects.toThrow(
      /client\.batch is missing/,
    );
    expect(executeMultiple).not.toHaveBeenCalled();
  });
});

describe("ensureUniqueConnectionIndex — local SQLite end-to-end", () => {
  const dbPaths: string[] = [];

  afterEach(() => {
    for (const p of dbPaths) {
      try {
        if (existsSync(p)) unlinkSync(p);
        if (existsSync(p + "-wal")) unlinkSync(p + "-wal");
        if (existsSync(p + "-shm")) unlinkSync(p + "-shm");
      } catch {
        // best-effort cleanup
      }
    }
    dbPaths.length = 0;
  });

  async function freshClient(): Promise<Client> {
    const path = resolve(tmpdir(), `lodis-eu-${randomBytes(8).toString("hex")}.db`);
    dbPaths.push(path);
    const client = createClient({ url: "file:" + path });
    await client.executeMultiple(`
      CREATE TABLE memory_connections (
        source_memory_id TEXT NOT NULL,
        target_memory_id TEXT NOT NULL,
        relationship TEXT NOT NULL
      );
    `);
    return client;
  }

  it("dedupes pre-existing duplicates and creates the unique index", async () => {
    const client = await freshClient();

    await client.executeMultiple(`
      INSERT INTO memory_connections (source_memory_id, target_memory_id, relationship) VALUES
        ('a', 'b', 'related'),
        ('a', 'b', 'related'),
        ('a', 'b', 'related'),
        ('a', 'b', 'works_at'),
        ('c', 'd', 'related');
    `);

    await ensureUniqueConnectionIndex(client, false);

    const rows = await client.execute({
      sql: `SELECT source_memory_id, target_memory_id, relationship FROM memory_connections
              ORDER BY source_memory_id, target_memory_id, relationship`,
      args: [],
    });
    expect(rows.rows.length).toBe(3);

    const idx = await client.execute({
      sql: `SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_memory_connections_unique'`,
      args: [],
    });
    expect(idx.rows.length).toBe(1);

    await expect(
      client.execute({
        sql: `INSERT INTO memory_connections (source_memory_id, target_memory_id, relationship) VALUES ('a', 'b', 'related')`,
        args: [],
      }),
    ).rejects.toThrow(/UNIQUE constraint/);

    await client.execute({
      sql: `INSERT INTO memory_connections (source_memory_id, target_memory_id, relationship) VALUES ('a', 'b', 'references')`,
      args: [],
    });
  });

  it("is idempotent — second call on a clean DB is a no-op", async () => {
    const client = await freshClient();
    await ensureUniqueConnectionIndex(client, false);
    await ensureUniqueConnectionIndex(client, false);

    const idx = await client.execute({
      sql: `SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_memory_connections_unique'`,
      args: [],
    });
    expect(idx.rows.length).toBe(1);
  });
});
