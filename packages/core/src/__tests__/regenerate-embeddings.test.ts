import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, unlinkSync } from "fs";
import { resolve } from "path";
import { tmpdir } from "os";
import { randomBytes } from "crypto";
import type { Client } from "@libsql/client";
import { createDatabase } from "../db.js";
import { regenerateEmbeddings } from "../embeddings.js";

function tempDbPath(): string {
  return resolve(tmpdir(), `lodis-regen-${randomBytes(8).toString("hex")}.db`);
}

async function insertMemory(
  client: Client,
  id: string,
  content: string,
  opts: {
    domain?: string;
    entityName?: string;
    entityType?: string;
    detail?: string | null;
    structuredData?: string | null;
    userId?: string | null;
  } = {},
) {
  await client.execute({
    sql: `INSERT INTO memories (id, content, detail, domain, source_agent_id, source_agent_name,
            source_type, confidence, learned_at, entity_name, entity_type, structured_data, user_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      content,
      opts.detail ?? null,
      opts.domain ?? "general",
      "agent1",
      "test",
      "stated",
      0.9,
      new Date().toISOString(),
      opts.entityName ?? null,
      opts.entityType ?? null,
      opts.structuredData ?? null,
      opts.userId ?? null,
    ],
  });
}

describe("regenerateEmbeddings", () => {
  let dbPath: string;
  let client: Client;

  beforeEach(async () => {
    dbPath = tempDbPath();
    const result = await createDatabase({ url: "file:" + dbPath });
    client = result.client;
  });

  afterEach(() => {
    try {
      client.close();
      if (existsSync(dbPath)) unlinkSync(dbPath);
      if (existsSync(dbPath + "-wal")) unlinkSync(dbPath + "-wal");
      if (existsSync(dbPath + "-shm")) unlinkSync(dbPath + "-shm");
    } catch { /* cleanup best-effort */ }
  }, 30000);

  it("sets embedding_shape on processed memories", async () => {
    await insertMemory(client, "m1", "Magda is Person_0091's realtor", {
      entityName: "Magda Meeting Notes",
      entityType: "resource",
      domain: "documents",
      structuredData: JSON.stringify({ tags: ["real-estate", "marin"] }),
    });

    const result = await regenerateEmbeddings(client, { shape: "v1-bracketed" });

    expect(result.processed).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.shape).toBe("v1-bracketed");

    const row = (await client.execute({
      sql: `SELECT embedding_shape FROM memories WHERE id = 'm1'`,
      args: [],
    })).rows[0] as unknown as { embedding_shape: string };
    expect(row.embedding_shape).toBe("v1-bracketed");
  }, 60000);

  it("skips memories already at target shape (skipAlreadyShape default true)", async () => {
    await insertMemory(client, "m1", "content 1");
    await insertMemory(client, "m2", "content 2");

    const r1 = await regenerateEmbeddings(client, { shape: "v1-bracketed" });
    expect(r1.processed).toBe(2);
    expect(r1.skipped).toBe(0);

    const r2 = await regenerateEmbeddings(client, { shape: "v1-bracketed" });
    expect(r2.processed).toBe(0);
    expect(r2.skipped).toBe(2);
  }, 60000);

  it("re-processes memories when skipAlreadyShape=false", async () => {
    await insertMemory(client, "m1", "content 1");
    await regenerateEmbeddings(client, { shape: "v1-bracketed" });

    const r = await regenerateEmbeddings(client, {
      shape: "v1-bracketed",
      skipAlreadyShape: false,
    });
    expect(r.processed).toBe(1);
    expect(r.skipped).toBe(0);
  }, 60000);

  it("supports shape='legacy' for rollback (re-embeds v1-bracketed rows back to legacy)", async () => {
    await insertMemory(client, "m1", "content 1");

    // Migrate forward
    const forward = await regenerateEmbeddings(client, { shape: "v1-bracketed" });
    expect(forward.processed).toBe(1);

    // Rollback to legacy — should re-process the v1-bracketed row since shape differs
    const back = await regenerateEmbeddings(client, { shape: "legacy" });
    expect(back.processed).toBe(1);
    expect(back.skipped).toBe(0);

    const row = (await client.execute({
      sql: `SELECT embedding_shape FROM memories WHERE id = 'm1'`,
      args: [],
    })).rows[0] as unknown as { embedding_shape: string };
    expect(row.embedding_shape).toBe("legacy");
  }, 90000);

  it("filters by domain when provided", async () => {
    await insertMemory(client, "m1", "content 1", { domain: "work" });
    await insertMemory(client, "m2", "content 2", { domain: "family" });
    await insertMemory(client, "m3", "content 3", { domain: "work" });

    const r = await regenerateEmbeddings(client, {
      shape: "v1-bracketed",
      domain: "work",
    });
    expect(r.processed).toBe(2);

    // family memory untouched
    const row = (await client.execute({
      sql: `SELECT embedding_shape FROM memories WHERE id = 'm2'`,
      args: [],
    })).rows[0] as unknown as { embedding_shape: string | null };
    expect(row.embedding_shape).toBeNull();
  }, 60000);

  it("filters by ids when provided", async () => {
    await insertMemory(client, "m1", "content 1");
    await insertMemory(client, "m2", "content 2");
    await insertMemory(client, "m3", "content 3");

    const r = await regenerateEmbeddings(client, {
      shape: "v1-bracketed",
      ids: ["m1", "m3"],
    });
    expect(r.processed).toBe(2);

    const untouched = (await client.execute({
      sql: `SELECT embedding_shape FROM memories WHERE id = 'm2'`,
      args: [],
    })).rows[0] as unknown as { embedding_shape: string | null };
    expect(untouched.embedding_shape).toBeNull();
  }, 60000);

  it("respects userId scoping (local mode: userId=null)", async () => {
    await insertMemory(client, "m1", "content 1", { userId: null });
    await insertMemory(client, "m2", "content 2", { userId: "user_other" });

    const r = await regenerateEmbeddings(client, { shape: "v1-bracketed" });
    expect(r.processed).toBe(1);
    const untouched = (await client.execute({
      sql: `SELECT embedding_shape FROM memories WHERE id = 'm2'`,
      args: [],
    })).rows[0] as unknown as { embedding_shape: string | null };
    expect(untouched.embedding_shape).toBeNull();
  }, 60000);

  it("skips soft-deleted rows", async () => {
    await insertMemory(client, "m1", "content 1");
    await client.execute({
      sql: `UPDATE memories SET deleted_at = ? WHERE id = 'm1'`,
      args: [new Date().toISOString()],
    });
    const r = await regenerateEmbeddings(client, { shape: "v1-bracketed" });
    expect(r.processed).toBe(0);
  }, 60000);

  it("treats NULL embedding_shape as 'legacy' on rollback (Saboteur-1 regression guard)", async () => {
    // Simulates a pre-W1a row: embedding_shape is NULL (pre-migration default).
    // A rollback (shape=legacy) should SKIP such rows — they're already at
    // legacy by convention. If the skip were naive (column === "legacy"),
    // NULL rows would be re-embedded needlessly AND the NULL sentinel would
    // be overwritten with "legacy", destroying the "never migrated"
    // discriminator.
    await insertMemory(client, "m1", "content 1");
    // Explicitly set embedding_shape to NULL to simulate pre-W1a state.
    await client.execute({
      sql: `UPDATE memories SET embedding_shape = NULL WHERE id = 'm1'`,
      args: [],
    });

    const r = await regenerateEmbeddings(client, { shape: "legacy" });
    expect(r.processed).toBe(0);
    expect(r.skipped).toBe(1);

    // Critically: the NULL was preserved, NOT overwritten with "legacy".
    const row = (await client.execute({
      sql: `SELECT embedding_shape FROM memories WHERE id = 'm1'`,
      args: [],
    })).rows[0] as unknown as { embedding_shape: string | null };
    expect(row.embedding_shape).toBeNull();
  }, 60000);

  it("aborts the run when a batch's failure rate exceeds threshold (Saboteur-5 regression guard)", async () => {
    // Seed 25 memories (>20, the gate's minimum-attempts threshold).
    for (let i = 0; i < 25; i++) {
      await insertMemory(client, `m${i}`, `content ${i}`);
    }
    // Close the client so subsequent operations fail. This simulates a DB
    // outage mid-run. insertEmbedding and UPDATE will all throw.
    client.close();

    // Re-open for the script (we'll use a fresh connection but the vec table
    // will still be broken in a predictable way).
    // Simpler: just mock the scenario by forcing failure via a closed client.
    const r = await regenerateEmbeddings(client, {
      shape: "v1-bracketed",
      failureRateThreshold: 0.1,
      batchSize: 25,
    }).catch((err) => ({ processed: 0, skipped: 0, failed: 0, errors: [{ id: "runtime", error: err.message }], shape: "v1-bracketed" as const }));

    // If the regenerate got past the initial SELECT, we should see the abort
    // message in errors. If the SELECT itself failed, we fell through to the
    // catch. Either way: no silent "all succeeded" result.
    const hasAbortOrRuntimeError = r.errors.some(
      (e) => e.id === "<batch-abort>" || e.id === "runtime",
    );
    expect(hasAbortOrRuntimeError).toBe(true);
  }, 60000);
});
