import { describe, it, expect, vi } from "vitest";
import type { Client } from "@libsql/client";
import { ensureUniqueConnectionIndex } from "../db.js";

describe("ensureUniqueConnectionIndex", () => {
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
});
