import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, unlinkSync } from "fs";
import { resolve } from "path";
import { tmpdir } from "os";
import { randomBytes } from "crypto";
import { createDatabase } from "../db.js";
import {
  bulkInsertMemories,
  resolveBulkRemoveTargets,
  bulkRemoveMemories,
  type BulkEntry,
} from "../bulk.js";
import type { Client } from "@libsql/client";

function tempDbPath(): string {
  return resolve(tmpdir(), `lodis-bulk-remove-${randomBytes(8).toString("hex")}.db`);
}

async function seed(client: Client, entries: BulkEntry[], opts: { userId?: string | null; vecAvailable: boolean }): Promise<string[]> {
  const r = await bulkInsertMemories(client, entries, {
    sourceAgentId: "seed-agent",
    sourceAgentName: "Seed",
    userId: opts.userId ?? null,
    vecAvailable: opts.vecAvailable,
    skipDedup: true,
  });
  return r.results.filter((x) => x.status === "written" && x.id).map((x) => x.id!);
}

async function aliveCount(client: Client, userId?: string | null): Promise<number> {
  const userFilter = userId ? "AND IFNULL(user_id, '') = IFNULL(?, '')" : "";
  const args = userId ? [userId] : [];
  const r = await client.execute({
    sql: `SELECT COUNT(*) as c FROM memories WHERE deleted_at IS NULL ${userFilter}`,
    args,
  });
  return (r.rows[0] as unknown as { c: number }).c;
}

async function deletedCount(client: Client): Promise<number> {
  const r = await client.execute({
    sql: `SELECT COUNT(*) as c FROM memories WHERE deleted_at IS NOT NULL`,
    args: [],
  });
  return (r.rows[0] as unknown as { c: number }).c;
}

async function eventCount(client: Client, type: string): Promise<number> {
  const r = await client.execute({
    sql: `SELECT COUNT(*) as c FROM memory_events WHERE event_type = ?`,
    args: [type],
  });
  return (r.rows[0] as unknown as { c: number }).c;
}

async function getMemoryRow(client: Client, id: string) {
  const r = await client.execute({
    sql: `SELECT id, deleted_at, domain, user_id FROM memories WHERE id = ?`,
    args: [id],
  });
  return r.rows[0] as unknown as { id: string; deleted_at: string | null; domain: string; user_id: string | null } | undefined;
}

async function lastModifiedAt(client: Client): Promise<string | undefined> {
  const r = await client.execute({
    sql: `SELECT value FROM lodis_meta WHERE key = 'last_modified'`,
    args: [],
  });
  return (r.rows[0] as unknown as { value: string } | undefined)?.value;
}

describe("bulkRemoveMemories + resolveBulkRemoveTargets", () => {
  let dbPath: string;
  let client: Client;
  let vecAvailable: boolean;

  beforeEach(async () => {
    dbPath = tempDbPath();
    const r = await createDatabase({ url: "file:" + dbPath });
    client = r.client;
    vecAvailable = r.vecAvailable;
  });

  afterEach(() => {
    try {
      client.close();
      for (const suffix of ["", "-wal", "-shm"]) {
        const p = dbPath + suffix;
        if (existsSync(p)) unlinkSync(p);
      }
    } catch {
      // best-effort
    }
  });

  it("rejects empty filter — never matches all memories", async () => {
    await seed(client, [{ content: "a", domain: "scratch" }], { vecAvailable });

    await expect(
      resolveBulkRemoveTargets(client, {}, {}),
    ).rejects.toThrow(/at least one of/i);

    expect(await aliveCount(client)).toBe(1);
  });

  it("validates ids[] shape and length", async () => {
    await expect(
      resolveBulkRemoveTargets(client, { ids: ["not-a-hex-id"] }, {}),
    ).rejects.toThrow(/32-char hex/);

    await expect(
      resolveBulkRemoveTargets(client, { ids: Array(5001).fill("a".repeat(32)) }, {}),
    ).rejects.toThrow(/capped at 5000/);
  });

  it("domain filter, dryRun-equivalent (resolve only): returns counts and sample ids without touching rows", async () => {
    await seed(
      client,
      [
        { content: "scratch one", domain: "scratch" },
        { content: "scratch two", domain: "scratch" },
        { content: "scratch three", domain: "scratch" },
        { content: "keepme", domain: "keep" },
      ],
      { vecAvailable },
    );

    const resolved = await resolveBulkRemoveTargets(client, { domain: "scratch" }, {});
    expect(resolved.targets).toHaveLength(3);
    expect(resolved.byDomain).toEqual({ scratch: 3 });
    expect(resolved.sampleIds).toHaveLength(3);
    expect(resolved.overflowed).toBe(false);

    // Read-only — nothing deleted yet
    expect(await aliveCount(client)).toBe(4);
    expect(await deletedCount(client)).toBe(0);
  });

  it("domain filter committed: soft-deletes rows, inserts removed events, bumps last_modified, leaves other domains intact", async () => {
    await seed(
      client,
      [
        { content: "scratch one", domain: "scratch" },
        { content: "scratch two", domain: "scratch" },
        { content: "scratch three", domain: "scratch" },
        { content: "keepme", domain: "keep" },
      ],
      { vecAvailable },
    );

    const before = await lastModifiedAt(client);
    // Tick the clock so last_modified must change.
    await new Promise((r) => setTimeout(r, 5));

    const resolved = await resolveBulkRemoveTargets(client, { domain: "scratch" }, {});
    const result = await bulkRemoveMemories(client, resolved.targets, {
      sourceAgentId: "agent-test",
      sourceAgentName: "Test",
      reason: "scratch cleanup",
    });

    expect(result.removed).toBe(3);
    expect(result.failed).toBe(0);
    expect(result.byDomain).toEqual({ scratch: 3 });
    expect(result.results.every((r) => r.status === "removed")).toBe(true);

    expect(await aliveCount(client)).toBe(1); // only keepme survives
    expect(await deletedCount(client)).toBe(3);
    expect(await eventCount(client, "removed")).toBe(3);

    // deleted_at populated on the right rows
    for (const t of resolved.targets) {
      const row = await getMemoryRow(client, t.id);
      expect(row?.deleted_at).toBeTruthy();
    }

    const after = await lastModifiedAt(client);
    expect(after).toBeTruthy();
    expect(after).not.toBe(before);

    // Removed-event payload includes the reason (sanitized)
    const ev = await client.execute({
      sql: `SELECT new_value FROM memory_events WHERE event_type = 'removed' LIMIT 1`,
      args: [],
    });
    const newValue = (ev.rows[0] as unknown as { new_value: string }).new_value;
    expect(JSON.parse(newValue).reason).toBe("scratch cleanup");
  });

  it("entityName filter is case-insensitive and scope-stable", async () => {
    await seed(
      client,
      [
        { content: "Sarah note 1", entityType: "person", entityName: "Sarah Chen", domain: "contacts" },
        { content: "Sarah note 2", entityType: "person", entityName: "sarah chen", domain: "contacts" },
        { content: "Bob note", entityType: "person", entityName: "Bob", domain: "contacts" },
      ],
      { vecAvailable },
    );

    const resolved = await resolveBulkRemoveTargets(client, { entityName: "SARAH chen" }, {});
    expect(resolved.targets).toHaveLength(2);

    const result = await bulkRemoveMemories(client, resolved.targets, { reason: "merge cleanup" });
    expect(result.removed).toBe(2);
    expect(await aliveCount(client)).toBe(1);
  });

  it("ids filter cross-tenant safety: rows belonging to a different user_id are not returned and not touched", async () => {
    const aliceIds = await seed(
      client,
      [{ content: "alice secret", domain: "personal" }],
      { vecAvailable, userId: "user-alice" },
    );
    const bobIds = await seed(
      client,
      [{ content: "bob secret", domain: "personal" }],
      { vecAvailable, userId: "user-bob" },
    );

    // Alice tries to delete both her own + Bob's id. Resolver scopes to Alice.
    const mixedIds = [...aliceIds, ...bobIds];
    const resolved = await resolveBulkRemoveTargets(
      client,
      { ids: mixedIds },
      { userId: "user-alice" },
    );
    expect(resolved.targets.map((t) => t.id)).toEqual(aliceIds);

    const result = await bulkRemoveMemories(client, resolved.targets, {
      userId: "user-alice",
      reason: "alice cleanup",
    });
    expect(result.removed).toBe(1);

    // Bob's row untouched
    const bobRow = await getMemoryRow(client, bobIds[0]);
    expect(bobRow?.deleted_at).toBeNull();
  });

  it("maxToScan overflow is signaled without touching rows", async () => {
    const entries: BulkEntry[] = Array.from({ length: 12 }, (_, i) => ({
      content: `bulk ${i}`,
      domain: "overflow",
    }));
    await seed(client, entries, { vecAvailable });

    const resolved = await resolveBulkRemoveTargets(
      client,
      { domain: "overflow" },
      { maxToScan: 5 },
    );
    expect(resolved.overflowed).toBe(true);
    expect(resolved.targets).toHaveLength(5);

    // Caller should refuse to call bulkRemoveMemories on overflow. Confirm
    // that nothing was written to deleted_at by the resolver itself.
    expect(await aliveCount(client)).toBe(12);
    expect(await deletedCount(client)).toBe(0);
  });

  it("already-deleted rows are excluded from resolution (re-runs are no-ops)", async () => {
    await seed(
      client,
      [
        { content: "a", domain: "scratch" },
        { content: "b", domain: "scratch" },
      ],
      { vecAvailable },
    );

    const r1 = await resolveBulkRemoveTargets(client, { domain: "scratch" }, {});
    await bulkRemoveMemories(client, r1.targets, { reason: "first pass" });

    const r2 = await resolveBulkRemoveTargets(client, { domain: "scratch" }, {});
    expect(r2.targets).toHaveLength(0);

    const result2 = await bulkRemoveMemories(client, r2.targets, { reason: "second pass" });
    expect(result2.removed).toBe(0);
    expect(result2.failed).toBe(0);
  });

  it("chunked transactions: large id list is split into multiple batches", async () => {
    const entries: BulkEntry[] = Array.from({ length: 25 }, (_, i) => ({
      content: `chunk ${i}`,
      domain: "chunked",
    }));
    await seed(client, entries, { vecAvailable });

    const resolved = await resolveBulkRemoveTargets(client, { domain: "chunked" }, {});
    const result = await bulkRemoveMemories(client, resolved.targets, {
      reason: "chunked test",
      batchSize: 7, // 25 / 7 = 4 chunks (7 + 7 + 7 + 4)
    });

    expect(result.removed).toBe(25);
    expect(result.failed).toBe(0);
    expect(await deletedCount(client)).toBe(25);
    expect(await eventCount(client, "removed")).toBe(25);
  });

  it("reason is sanitized — newlines and control chars stripped, capped at 500 chars", async () => {
    const ids = await seed(client, [{ content: "x", domain: "san" }], { vecAvailable });
    const resolved = await resolveBulkRemoveTargets(client, { ids }, {});

    const evilReason = "line1\nline2\rline3\x00null" + "A".repeat(800);
    await bulkRemoveMemories(client, resolved.targets, { reason: evilReason });

    const ev = await client.execute({
      sql: `SELECT new_value FROM memory_events WHERE event_type = 'removed' LIMIT 1`,
      args: [],
    });
    const stored = JSON.parse((ev.rows[0] as unknown as { new_value: string }).new_value).reason as string;
    expect(stored).not.toMatch(/[\r\n\x00]/);
    expect(stored.length).toBeLessThanOrEqual(500);
  });
});
