import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, unlinkSync } from "fs";
import { resolve } from "path";
import { tmpdir } from "os";
import { randomBytes } from "crypto";
import type { Client } from "@libsql/client";
import { createDatabase } from "../db.js";
import {
  applyCallerSuppliedConnections,
  applyEntityNameAutoEdges,
  isL2EnrichmentEnabled,
  selectSourceMemoriesForProposals,
  generateCandidatesForMemory,
  validateAndInsertConnectBatch,
  type ConnectionInput,
  type ConnectBatchInput,
  type ProposalSourceRow,
} from "../connections.js";

function tempDbPath(): string {
  return resolve(tmpdir(), `lodis-conn-${randomBytes(8).toString("hex")}.db`);
}

interface InsertOpts {
  entityName?: string | null;
  entityType?: string | null;
  domain?: string;
  userId?: string | null;
  learnedAt?: string;
  updatedAt?: string;
}

async function insertMemory(client: Client, id: string, content: string, opts: InsertOpts = {}) {
  const ts = opts.learnedAt ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  await client.execute({
    sql: `INSERT INTO memories
            (id, content, domain, source_agent_id, source_agent_name, source_type,
             confidence, learned_at, updated_at,
             entity_type, entity_name, user_id)
          VALUES (?1, ?2, ?3, 'a1', 't', 'stated', 0.9, ?4, ?5, ?6, ?7, ?8)`,
    args: [
      id,
      content,
      opts.domain ?? "general",
      ts,
      opts.updatedAt ?? ts,
      opts.entityType ?? null,
      opts.entityName ?? null,
      opts.userId ?? null,
    ],
  });
}

async function listEdges(client: Client) {
  const r = await client.execute({
    sql: `SELECT source_memory_id, target_memory_id, relationship
            FROM memory_connections
           ORDER BY source_memory_id, target_memory_id, relationship`,
    args: [],
  });
  return r.rows.map((row) => ({
    source: row.source_memory_id as string,
    target: row.target_memory_id as string,
    relationship: row.relationship as string,
  }));
}

describe("isL2EnrichmentEnabled", () => {
  it("defaults to enabled when no flag is set", () => {
    expect(isL2EnrichmentEnabled({})).toBe(true);
  });
  it("DISABLED=1 wins (kill switch)", () => {
    expect(isL2EnrichmentEnabled({ LODIS_L2_ENRICHMENT_DISABLED: "1" })).toBe(false);
  });
  it("DISABLED=0 stays enabled (only =1 disables)", () => {
    expect(isL2EnrichmentEnabled({ LODIS_L2_ENRICHMENT_DISABLED: "0" })).toBe(true);
  });
});

describe("connections module — DB-backed integration tests", () => {
  let dbPath: string;
  let client: Client;
  let originalL2Disabled: string | undefined;

  beforeEach(async () => {
    dbPath = tempDbPath();
    const result = await createDatabase({ url: "file:" + dbPath });
    client = result.client;
    originalL2Disabled = process.env.LODIS_L2_ENRICHMENT_DISABLED;
    delete process.env.LODIS_L2_ENRICHMENT_DISABLED;
  });

  afterEach(() => {
    if (originalL2Disabled === undefined) delete process.env.LODIS_L2_ENRICHMENT_DISABLED;
    else process.env.LODIS_L2_ENRICHMENT_DISABLED = originalL2Disabled;
    try {
      client.close();
      if (existsSync(dbPath)) unlinkSync(dbPath);
      if (existsSync(dbPath + "-wal")) unlinkSync(dbPath + "-wal");
      if (existsSync(dbPath + "-shm")) unlinkSync(dbPath + "-shm");
    } catch { /* best-effort */ }
  });

  describe("applyCallerSuppliedConnections (L1)", () => {
    it("inserts an edge by targetMemoryId", async () => {
      await insertMemory(client, "src", "src content");
      await insertMemory(client, "tgt", "tgt content");
      const r = await applyCallerSuppliedConnections(
        client,
        "src",
        [{ targetMemoryId: "tgt", relationship: "related" }],
        null,
      );
      expect(r.applied).toBe(1);
      expect(r.dropped).toEqual([]);
      const edges = await listEdges(client);
      expect(edges).toEqual([{ source: "src", target: "tgt", relationship: "related" }]);
    });

    it("inserts an edge by targetEntityName (case-insensitive)", async () => {
      await insertMemory(client, "src", "src content");
      await insertMemory(client, "magda", "Magda meeting notes", { entityName: "Magda" });
      const r = await applyCallerSuppliedConnections(
        client,
        "src",
        [{ targetEntityName: "magda", relationship: "about" }],   // lowercase
        null,
      );
      expect(r.applied).toBe(1);
      const edges = await listEdges(client);
      expect(edges).toEqual([{ source: "src", target: "magda", relationship: "about" }]);
    });

    it("rejects self-references", async () => {
      await insertMemory(client, "self", "x");
      const r = await applyCallerSuppliedConnections(
        client,
        "self",
        [{ targetMemoryId: "self", relationship: "related" }],
        null,
      );
      expect(r.applied).toBe(0);
      expect(r.dropped[0]?.reason).toBe("self_reference");
    });

    it("rejects when neither targetMemoryId nor targetEntityName supplied", async () => {
      await insertMemory(client, "src", "x");
      const r = await applyCallerSuppliedConnections(
        client,
        "src",
        [{ relationship: "related" } as ConnectionInput],
        null,
      );
      expect(r.applied).toBe(0);
      expect(r.dropped[0]?.reason).toBe("missing_target");
    });

    it("rejects unresolvable targetEntityName as not_found", async () => {
      await insertMemory(client, "src", "x");
      const r = await applyCallerSuppliedConnections(
        client,
        "src",
        [{ targetEntityName: "Ghost", relationship: "related" }],
        null,
      );
      expect(r.applied).toBe(0);
      expect(r.dropped[0]?.reason).toBe("not_found");
    });

    it("returns duplicate on re-insert (relies on unique index from migration)", async () => {
      await insertMemory(client, "src", "x");
      await insertMemory(client, "tgt", "y");
      const inputs: ConnectionInput[] = [{ targetMemoryId: "tgt", relationship: "related" }];
      const first = await applyCallerSuppliedConnections(client, "src", inputs, null);
      expect(first.applied).toBe(1);
      const second = await applyCallerSuppliedConnections(client, "src", inputs, null);
      expect(second.applied).toBe(0);
      expect(second.dropped[0]?.reason).toBe("duplicate");
      // No double row.
      const edges = await listEdges(client);
      expect(edges.length).toBe(1);
    });

    it("Security F3: targetEntityName never crosses user boundary (NULL vs userA)", async () => {
      // Source belongs to user "alice"; a Magda memory belongs to a DIFFERENT user.
      // Even though entity_name matches, the cross-user resolution must fail.
      await insertMemory(client, "src", "x", { userId: "alice" });
      await insertMemory(client, "magda_other", "Magda for someone else", {
        entityName: "Magda",
        userId: "bob",
      });
      const r = await applyCallerSuppliedConnections(
        client,
        "src",
        [{ targetEntityName: "Magda", relationship: "about" }],
        "alice",
      );
      expect(r.applied).toBe(0);
      expect(r.dropped[0]?.reason).toBe("not_found");
      const edges = await listEdges(client);
      expect(edges).toEqual([]);
    });

    it("Security F3: targetMemoryId is also blocked across user boundary", async () => {
      // Even with the explicit id, we must verify ownership before insert.
      await insertMemory(client, "src", "x", { userId: "alice" });
      await insertMemory(client, "tgt_other", "y", { userId: "bob" });
      const r = await applyCallerSuppliedConnections(
        client,
        "src",
        [{ targetMemoryId: "tgt_other", relationship: "related" }],
        "alice",
      );
      expect(r.applied).toBe(0);
      expect(r.dropped[0]?.reason).toBe("not_found");
    });

    it("multi-match resolution: most-recently-updated wins", async () => {
      await insertMemory(client, "src", "x");
      await insertMemory(client, "magda_old", "older", { entityName: "Magda", updatedAt: "2024-01-01T00:00:00Z" });
      await insertMemory(client, "magda_new", "newer", { entityName: "Magda", updatedAt: "2026-01-01T00:00:00Z" });
      const r = await applyCallerSuppliedConnections(
        client,
        "src",
        [{ targetEntityName: "Magda", relationship: "related" }],
        null,
      );
      expect(r.applied).toBe(1);
      const edges = await listEdges(client);
      expect(edges[0].target).toBe("magda_new");
    });

    it("returns no-op for empty input list", async () => {
      const r = await applyCallerSuppliedConnections(client, "anything", [], null);
      expect(r).toEqual({ applied: 0, dropped: [] });
    });
  });

  describe("applyEntityNameAutoEdges (L2a)", () => {
    it("creates `related` edges to all matching entity_name memories (up to 10)", async () => {
      await insertMemory(client, "src", "src", { entityName: "James" });
      for (let i = 0; i < 12; i++) {
        await insertMemory(client, `m${i}`, `c${i}`, { entityName: "James" });
      }
      const r = await applyEntityNameAutoEdges(client, "src", "James", null);
      expect(r.applied).toBe(10);   // bounded
      const edges = await listEdges(client);
      expect(edges.length).toBe(10);
      expect(edges.every((e) => e.source === "src" && e.relationship === "related")).toBe(true);
    });

    it("returns zero applied when entity_name is null/empty", async () => {
      await insertMemory(client, "src", "x");
      expect((await applyEntityNameAutoEdges(client, "src", null, null)).applied).toBe(0);
      expect((await applyEntityNameAutoEdges(client, "src", "", null)).applied).toBe(0);
      expect((await applyEntityNameAutoEdges(client, "src", "   ", null)).applied).toBe(0);
    });

    it("respects LODIS_L2_ENRICHMENT_DISABLED=1 kill switch", async () => {
      process.env.LODIS_L2_ENRICHMENT_DISABLED = "1";
      await insertMemory(client, "src", "x", { entityName: "James" });
      await insertMemory(client, "tgt", "y", { entityName: "James" });
      const r = await applyEntityNameAutoEdges(client, "src", "James", null);
      expect(r.applied).toBe(0);
      const edges = await listEdges(client);
      expect(edges).toEqual([]);
    });

    it("does not include cross-user matches", async () => {
      await insertMemory(client, "src", "x", { entityName: "James", userId: "alice" });
      await insertMemory(client, "alice_match", "y", { entityName: "James", userId: "alice" });
      await insertMemory(client, "bob_match", "z", { entityName: "James", userId: "bob" });
      const r = await applyEntityNameAutoEdges(client, "src", "James", "alice");
      expect(r.applied).toBe(1);
      const edges = await listEdges(client);
      expect(edges).toEqual([{ source: "src", target: "alice_match", relationship: "related" }]);
    });

    it("idempotent across re-runs (relies on unique index)", async () => {
      await insertMemory(client, "src", "x", { entityName: "James" });
      await insertMemory(client, "tgt", "y", { entityName: "James" });
      const first = await applyEntityNameAutoEdges(client, "src", "James", null);
      expect(first.applied).toBe(1);
      const second = await applyEntityNameAutoEdges(client, "src", "James", null);
      expect(second.applied).toBe(0);
      const edges = await listEdges(client);
      expect(edges.length).toBe(1);
    });

    it("never throws on internal errors (returns zero)", async () => {
      // close client to force an error on next query
      client.close();
      const r = await applyEntityNameAutoEdges(client, "src", "James", null);
      expect(r.applied).toBe(0);
    });
  });

  describe("selectSourceMemoriesForProposals (L3)", () => {
    it("returns only memories with zero outgoing edges", async () => {
      const old = "2026-01-01T00:00:00Z";
      await insertMemory(client, "connected", "x", { learnedAt: old, entityType: "fact" });
      await insertMemory(client, "isolated", "y", { learnedAt: old, entityType: "fact" });
      await insertMemory(client, "other", "z", { learnedAt: old, entityType: "fact" });
      // Connect "connected" → "other" so "connected" has outgoing edges
      await client.execute({
        sql: `INSERT INTO memory_connections (source_memory_id, target_memory_id, relationship) VALUES (?, ?, 'related')`,
        args: ["connected", "other"],
      });
      const sources = await selectSourceMemoriesForProposals(client, null, { limit: 10, minAgeHours: 0 });
      const ids = sources.map((s) => s.id).sort();
      // "connected" excluded (has outgoing); "isolated" + "other" included.
      // (Note: "other" has incoming, not outgoing — incoming doesn't disqualify.)
      expect(ids).toEqual(["isolated", "other"]);
    });

    it("excludes snippets explicitly (Saboteur F8 livelock prevention)", async () => {
      const old = "2026-01-01T00:00:00Z";
      await insertMemory(client, "fact", "x", { learnedAt: old, entityType: "fact" });
      await insertMemory(client, "snip", "y", { learnedAt: old, entityType: "snippet" });
      const sources = await selectSourceMemoriesForProposals(client, null, { minAgeHours: 0 });
      expect(sources.map((s) => s.id)).toEqual(["fact"]);
    });

    it("honors minAgeHours cooldown (gives L1+L2a a chance)", async () => {
      const fresh = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1h ago
      const old = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(); // 12h ago
      await insertMemory(client, "freshie", "x", { learnedAt: fresh, entityType: "fact" });
      await insertMemory(client, "oldie", "y", { learnedAt: old, entityType: "fact" });
      const sources = await selectSourceMemoriesForProposals(client, null, { minAgeHours: 6 });
      expect(sources.map((s) => s.id)).toEqual(["oldie"]);
    });

    it("user-scoped: alice's call doesn't see bob's memories", async () => {
      const old = "2026-01-01T00:00:00Z";
      await insertMemory(client, "alice_m", "x", { learnedAt: old, userId: "alice", entityType: "fact" });
      await insertMemory(client, "bob_m", "y", { learnedAt: old, userId: "bob", entityType: "fact" });
      const sources = await selectSourceMemoriesForProposals(client, "alice", { minAgeHours: 0 });
      expect(sources.map((s) => s.id)).toEqual(["alice_m"]);
    });

    it("respects limit parameter", async () => {
      const old = "2026-01-01T00:00:00Z";
      for (let i = 0; i < 5; i++) {
        await insertMemory(client, `m${i}`, "x", { learnedAt: old, entityType: "fact" });
      }
      const sources = await selectSourceMemoriesForProposals(client, null, { limit: 2, minAgeHours: 0 });
      expect(sources.length).toBe(2);
    });

    it("excludePii=true filters has_pii_flag=1 rows server-side (Sb-C2 fix)", async () => {
      const old = "2026-01-01T00:00:00Z";
      // Insert two PII rows oldest, then a non-PII row. With LIMIT 2 + client-
      // side PII filter (the bug shape from /code-review round 1), we'd get
      // both PII back, drop them, and miss the non-PII. With excludePii at SQL
      // we should skip the PII rows server-side and return the non-PII directly.
      await client.execute({
        sql: `INSERT INTO memories (id, content, domain, source_agent_id, source_agent_name, source_type, confidence, learned_at, updated_at, entity_type, has_pii_flag) VALUES (?, ?, 'general', 'a', 't', 'stated', 0.9, ?, ?, 'fact', 1)`,
        args: ["pii_a", "pii content a", old, old],
      });
      await client.execute({
        sql: `INSERT INTO memories (id, content, domain, source_agent_id, source_agent_name, source_type, confidence, learned_at, updated_at, entity_type, has_pii_flag) VALUES (?, ?, 'general', 'a', 't', 'stated', 0.9, ?, ?, 'fact', 1)`,
        args: ["pii_b", "pii content b", old, old],
      });
      await insertMemory(client, "clean", "z", { learnedAt: old, entityType: "fact" });
      const sources = await selectSourceMemoriesForProposals(client, null, {
        limit: 2,
        minAgeHours: 0,
        excludePii: true,
      });
      // Both PII rows excluded server-side; non-PII row returned.
      expect(sources.map((s) => s.id)).toEqual(["clean"]);
    });

    it("excludeIds skips listed IDs at the SQL layer (Perf-W8 fix — resume cursor)", async () => {
      const old = "2026-01-01T00:00:00Z";
      await insertMemory(client, "m1", "x", { learnedAt: old, entityType: "fact" });
      await insertMemory(client, "m2", "y", { learnedAt: old, entityType: "fact" });
      await insertMemory(client, "m3", "z", { learnedAt: old, entityType: "fact" });
      const sources = await selectSourceMemoriesForProposals(client, null, {
        minAgeHours: 0,
        excludeIds: ["m1", "m2"],
      });
      expect(sources.map((s) => s.id)).toEqual(["m3"]);
    });

    it("includeAlreadyConnected=true returns even memories with edges", async () => {
      const old = "2026-01-01T00:00:00Z";
      await insertMemory(client, "src", "x", { learnedAt: old, entityType: "fact" });
      await insertMemory(client, "tgt", "y", { learnedAt: old, entityType: "fact" });
      await client.execute({
        sql: `INSERT INTO memory_connections (source_memory_id, target_memory_id, relationship) VALUES (?, ?, 'related')`,
        args: ["src", "tgt"],
      });
      const sources = await selectSourceMemoriesForProposals(client, null, {
        minAgeHours: 0,
        includeAlreadyConnected: true,
      });
      expect(sources.map((s) => s.id).sort()).toEqual(["src", "tgt"]);
    });
  });

  describe("generateCandidatesForMemory (L3)", () => {
    function srcRow(id: string, opts: Partial<ProposalSourceRow> = {}): ProposalSourceRow {
      return {
        id,
        content: opts.content ?? "src content",
        detail: opts.detail ?? null,
        entity_name: opts.entity_name ?? null,
        entity_type: opts.entity_type ?? "fact",
        domain: opts.domain ?? "general",
      };
    }

    it("returns entity-name matches as candidates", async () => {
      await insertMemory(client, "src", "x", { entityName: "Magda" });
      await insertMemory(client, "magda1", "y", { entityName: "Magda" });
      await insertMemory(client, "magda2", "z", { entityName: "Magda" });
      const cands = await generateCandidatesForMemory(
        client,
        srcRow("src", { entity_name: "Magda" }),
        null,
      );
      const ids = cands.map((c) => c.id).sort();
      expect(ids).toEqual(["magda1", "magda2"]);
    });

    it("excludes the source itself + already-connected candidates", async () => {
      await insertMemory(client, "src", "x", { entityName: "Magda" });
      await insertMemory(client, "magda1", "y", { entityName: "Magda" });
      await insertMemory(client, "magda2", "z", { entityName: "Magda" });
      // Pre-existing edge from src → magda1 should exclude magda1
      await client.execute({
        sql: `INSERT INTO memory_connections (source_memory_id, target_memory_id, relationship) VALUES (?, ?, 'related')`,
        args: ["src", "magda1"],
      });
      const cands = await generateCandidatesForMemory(
        client,
        srcRow("src", { entity_name: "Magda" }),
        null,
      );
      expect(cands.map((c) => c.id)).toEqual(["magda2"]);
    });

    it("augments with same-domain memories when entity matches are scarce", async () => {
      await insertMemory(client, "src", "x", { entityName: "Magda", domain: "real-estate" });
      // No other Magda memory; same-domain neighbors:
      await insertMemory(client, "rd1", "y", { domain: "real-estate" });
      await insertMemory(client, "rd2", "z", { domain: "real-estate" });
      // Different-domain memory should NOT be returned:
      await insertMemory(client, "off1", "off-topic", { domain: "general" });
      const cands = await generateCandidatesForMemory(
        client,
        srcRow("src", { entity_name: "Magda", domain: "real-estate" }),
        null,
      );
      const ids = cands.map((c) => c.id).sort();
      expect(ids).toContain("rd1");
      expect(ids).toContain("rd2");
      expect(ids).not.toContain("off1");
    });

    it("returns content_snippet bounded to 200 chars", async () => {
      await insertMemory(client, "src", "x", { entityName: "Magda" });
      await insertMemory(client, "tgt", "x".repeat(500), { entityName: "Magda" });
      const cands = await generateCandidatesForMemory(
        client,
        srcRow("src", { entity_name: "Magda" }),
        null,
      );
      expect(cands[0].content_snippet.length).toBeLessThanOrEqual(200);
    });

    it("returns empty when source has no entity_name AND no same-domain neighbors", async () => {
      await insertMemory(client, "src", "x", { domain: "lonely-domain" });
      const cands = await generateCandidatesForMemory(
        client,
        srcRow("src", { domain: "lonely-domain" }),
        null,
      );
      expect(cands).toEqual([]);
    });
  });

  describe("validateAndInsertConnectBatch (memory_connect_batch core)", () => {
    it("inserts a valid batch", async () => {
      await insertMemory(client, "a", "x");
      await insertMemory(client, "b", "y");
      const r = await validateAndInsertConnectBatch(
        client,
        [{ source_memory_id: "a", target_memory_id: "b", relationship: "related" }],
        null,
      );
      expect(r.applied).toBe(1);
      expect(r.dropped).toEqual([]);
    });

    it("Security F1 (CRITICAL): rejects when target belongs to a different user — cross-user graph poisoning blocked", async () => {
      await insertMemory(client, "alice_src", "x", { userId: "alice" });
      await insertMemory(client, "bob_tgt", "y", { userId: "bob" });
      const r = await validateAndInsertConnectBatch(
        client,
        [{ source_memory_id: "alice_src", target_memory_id: "bob_tgt", relationship: "related" }],
        "alice",
      );
      expect(r.applied).toBe(0);
      expect(r.dropped[0]?.reason).toBe("not_owned_or_missing");
      const edges = await listEdges(client);
      expect(edges).toEqual([]);
    });

    it("Security F1 (CRITICAL): rejects when source belongs to a different user", async () => {
      await insertMemory(client, "alice_src", "x", { userId: "alice" });
      await insertMemory(client, "alice_tgt", "y", { userId: "alice" });
      // Caller claims to be bob but tries to write an edge between alice's memories
      const r = await validateAndInsertConnectBatch(
        client,
        [{ source_memory_id: "alice_src", target_memory_id: "alice_tgt", relationship: "related" }],
        "bob",
      );
      expect(r.applied).toBe(0);
      expect(r.dropped[0]?.reason).toBe("not_owned_or_missing");
    });

    it("rejects self-references", async () => {
      await insertMemory(client, "self", "x");
      const r = await validateAndInsertConnectBatch(
        client,
        [{ source_memory_id: "self", target_memory_id: "self", relationship: "related" }],
        null,
      );
      expect(r.applied).toBe(0);
      expect(r.dropped[0]?.reason).toBe("self_reference");
    });

    it("returns duplicate on re-insert (idempotent re-runs of L4 are safe)", async () => {
      await insertMemory(client, "a", "x");
      await insertMemory(client, "b", "y");
      const inputs: ConnectBatchInput[] = [{ source_memory_id: "a", target_memory_id: "b", relationship: "related" }];
      const first = await validateAndInsertConnectBatch(client, inputs, null);
      expect(first.applied).toBe(1);
      const second = await validateAndInsertConnectBatch(client, inputs, null);
      expect(second.applied).toBe(0);
      expect(second.dropped[0]?.reason).toBe("duplicate");
    });

    it("rejects when target id doesn't exist", async () => {
      await insertMemory(client, "src", "x");
      const r = await validateAndInsertConnectBatch(
        client,
        [{ source_memory_id: "src", target_memory_id: "ghost", relationship: "related" }],
        null,
      );
      expect(r.applied).toBe(0);
      expect(r.dropped[0]?.reason).toBe("not_owned_or_missing");
    });

    it("processes mixed batch: applies valid entries, drops invalid ones", async () => {
      await insertMemory(client, "a", "x", { userId: "alice" });
      await insertMemory(client, "b", "y", { userId: "alice" });
      await insertMemory(client, "c", "z", { userId: "alice" });
      await insertMemory(client, "bob_x", "y", { userId: "bob" });
      const r = await validateAndInsertConnectBatch(
        client,
        [
          { source_memory_id: "a", target_memory_id: "b", relationship: "related" }, // good
          { source_memory_id: "a", target_memory_id: "bob_x", relationship: "related" }, // cross-user → drop
          { source_memory_id: "a", target_memory_id: "c", relationship: "related" }, // good
        ],
        "alice",
      );
      expect(r.applied).toBe(2);
      expect(r.dropped.length).toBe(1);
      expect(r.dropped[0].target_memory_id).toBe("bob_x");
    });
  });
});
