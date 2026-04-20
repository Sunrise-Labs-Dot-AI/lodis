// SQL-pattern tests for the server actions in
// packages/dashboard/src/app/agents/actions.ts that didn't have dedicated
// coverage:
//   - applyPreset sensitive-domain confirmation gate (C1)
//   - resetAgentRules scoping (W9)
//   - markDomainSensitive idempotence + userId scoping (W9)
//   - unique-index dedupe migration behavior (W2)
//
// The action code lives in a Next "use server" file that has no Vitest
// infra in the dashboard package. These tests exercise the exact SQL
// patterns the actions use against a libsql DB so any SQL-level
// regression is caught even before the full Next stack runs.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { resolve } from "path";
import { randomBytes } from "crypto";
import { createClient, type Client } from "@libsql/client";

function tempDbPath(): string {
  return resolve(tmpdir(), `lodis-agent-actions-${randomBytes(8).toString("hex")}.db`);
}

async function setup(db: Client): Promise<void> {
  await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS agent_permissions (
      agent_id TEXT NOT NULL,
      domain TEXT NOT NULL,
      can_read INTEGER NOT NULL DEFAULT 1,
      can_write INTEGER NOT NULL DEFAULT 1,
      user_id TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_permissions_unique
      ON agent_permissions(agent_id, domain, IFNULL(user_id, ''));
    CREATE TABLE IF NOT EXISTS sensitive_domains (
      user_id TEXT,
      domain TEXT NOT NULL,
      marked_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_sensitive_domains_user_domain
      ON sensitive_domains(IFNULL(user_id, ''), domain);
  `);
}

// --- Helpers mirroring the server-action SQL patterns ---

function userFilter(userId: string | null): { clause: string; args: (string | null)[] } {
  if (!userId) return { clause: "", args: [] };
  return { clause: " AND user_id = ?", args: [userId] };
}

async function presetStmts(
  db: Client,
  agentId: string,
  userId: string | null,
  allowlist: string[],
  confirmedSensitiveDomains: string[] = [],
): Promise<{ sql: string; args: (string | null)[] }[]> {
  // Mirror applyPreset's sensitive-gate check.
  if (allowlist.length > 0) {
    const uf = userFilter(userId);
    const placeholders = allowlist.map(() => "?").join(",");
    const sensitive = await db.execute({
      sql: `SELECT domain FROM sensitive_domains
              WHERE domain IN (${placeholders})${uf.clause}`,
      args: [...allowlist, ...uf.args],
    });
    const sensitiveSet = new Set(sensitive.rows.map(r => r.domain as string));
    const confirmed = new Set(confirmedSensitiveDomains);
    const missing = [...sensitiveSet].filter(d => !confirmed.has(d));
    if (missing.length > 0) {
      throw new Error(`Sensitive domains require confirmation: ${missing.join(", ")}`);
    }
  }
  const uf = userFilter(userId);
  return [
    { sql: `DELETE FROM agent_permissions WHERE agent_id = ?${uf.clause}`, args: [agentId, ...uf.args] },
    {
      sql: `INSERT INTO agent_permissions (agent_id, domain, can_read, can_write, user_id) VALUES (?, '*', 0, 0, ?)`,
      args: [agentId, userId],
    },
    ...allowlist.map(d => ({
      sql: `INSERT INTO agent_permissions (agent_id, domain, can_read, can_write, user_id) VALUES (?, ?, 1, 1, ?)`,
      args: [agentId, d, userId] as (string | null)[],
    })),
  ];
}

describe("applyPreset — sensitive-domain confirmation gate (C1)", () => {
  let dbPath: string;
  let db: Client;

  beforeEach(async () => {
    dbPath = tempDbPath();
    db = createClient({ url: "file:" + dbPath });
    await setup(db);
  });
  afterEach(() => {
    try { db.close(); } catch { /* noop */ }
    for (const suffix of ["", "-wal", "-shm"]) {
      const p = dbPath + suffix;
      if (existsSync(p)) try { unlinkSync(p); } catch { /* noop */ }
    }
  });

  it("throws when allowlist includes a sensitive domain without confirmation", async () => {
    await db.execute({
      sql: `INSERT INTO sensitive_domains (user_id, domain, marked_at) VALUES (?, ?, ?)`,
      args: [null, "healthcare", new Date().toISOString()],
    });

    await expect(
      presetStmts(db, "agent_x", null, ["healthcare", "work"], /* confirmed */ []),
    ).rejects.toThrow(/Sensitive domains require confirmation/);

    // Rules should be unchanged because the stmts never executed.
    const remaining = await db.execute({
      sql: `SELECT COUNT(*) as c FROM agent_permissions WHERE agent_id = ?`,
      args: ["agent_x"],
    });
    expect((remaining.rows[0] as { c: number }).c).toBe(0);
  });

  it("accepts when sensitive domains are explicitly confirmed", async () => {
    await db.execute({
      sql: `INSERT INTO sensitive_domains (user_id, domain, marked_at) VALUES (?, ?, ?)`,
      args: [null, "healthcare", new Date().toISOString()],
    });

    const stmts = await presetStmts(
      db,
      "agent_x",
      null,
      ["healthcare", "work"],
      ["healthcare"],
    );
    await db.batch(stmts, "write");

    const rows = (await db.execute({
      sql: `SELECT domain FROM agent_permissions WHERE agent_id = ? ORDER BY domain`,
      args: ["agent_x"],
    })).rows.map(r => r.domain as string);
    expect(rows).toEqual(["*", "healthcare", "work"]);
  });

  it("is user-scoped — other users' sensitive marks don't affect caller", async () => {
    // User A marks "healthcare" sensitive.
    await db.execute({
      sql: `INSERT INTO sensitive_domains (user_id, domain, marked_at) VALUES (?, ?, ?)`,
      args: ["user_a", "healthcare", new Date().toISOString()],
    });
    // User B applies a preset with "healthcare" in allowlist and no confirmation.
    // Because B has not marked it sensitive, no gate fires.
    const stmts = await presetStmts(db, "agent_x", "user_b", ["healthcare"], []);
    await db.batch(stmts, "write");
    const rows = await db.execute({
      sql: `SELECT domain FROM agent_permissions WHERE agent_id = ? AND user_id = ? ORDER BY domain`,
      args: ["agent_x", "user_b"],
    });
    expect(rows.rows.length).toBe(2);
  });
});

describe("resetAgentRules — scoping (W9)", () => {
  let dbPath: string;
  let db: Client;

  beforeEach(async () => {
    dbPath = tempDbPath();
    db = createClient({ url: "file:" + dbPath });
    await setup(db);
  });
  afterEach(() => {
    try { db.close(); } catch { /* noop */ }
    for (const suffix of ["", "-wal", "-shm"]) {
      const p = dbPath + suffix;
      if (existsSync(p)) try { unlinkSync(p); } catch { /* noop */ }
    }
  });

  async function resetRules(agentId: string, userId: string | null) {
    const uf = userFilter(userId);
    await db.execute({
      sql: `DELETE FROM agent_permissions WHERE agent_id = ?${uf.clause}`,
      args: [agentId, ...uf.args],
    });
  }

  it("removes all rules for the target agent", async () => {
    await db.batch([
      { sql: `INSERT INTO agent_permissions (agent_id, domain, can_read, can_write, user_id) VALUES ('a', '*', 0, 0, NULL)` },
      { sql: `INSERT INTO agent_permissions (agent_id, domain, can_read, can_write, user_id) VALUES ('a', 'work', 1, 1, NULL)` },
      { sql: `INSERT INTO agent_permissions (agent_id, domain, can_read, can_write, user_id) VALUES ('a', 'finance', 0, 0, NULL)` },
    ], "write");
    await resetRules("a", null);
    const n = (await db.execute({ sql: `SELECT COUNT(*) as c FROM agent_permissions WHERE agent_id = 'a'`, args: [] })).rows[0] as { c: number };
    expect(n.c).toBe(0);
  });

  it("does not touch other agents' rules", async () => {
    await db.batch([
      { sql: `INSERT INTO agent_permissions (agent_id, domain, can_read, can_write, user_id) VALUES ('a', '*', 0, 0, NULL)` },
      { sql: `INSERT INTO agent_permissions (agent_id, domain, can_read, can_write, user_id) VALUES ('b', 'untouched', 1, 1, NULL)` },
    ], "write");
    await resetRules("a", null);
    const b = (await db.execute({ sql: `SELECT domain FROM agent_permissions WHERE agent_id = 'b'`, args: [] })).rows;
    expect(b.length).toBe(1);
    expect((b[0] as { domain: string }).domain).toBe("untouched");
  });

  it("is user-scoped — other users' rules for the same agent id survive", async () => {
    await db.batch([
      { sql: `INSERT INTO agent_permissions (agent_id, domain, can_read, can_write, user_id) VALUES ('shared', 'w', 1, 1, 'user_a')` },
      { sql: `INSERT INTO agent_permissions (agent_id, domain, can_read, can_write, user_id) VALUES ('shared', 'w', 1, 1, 'user_b')` },
    ], "write");
    await resetRules("shared", "user_a");
    const remaining = (await db.execute({
      sql: `SELECT user_id FROM agent_permissions WHERE agent_id = 'shared'`,
      args: [],
    })).rows;
    expect(remaining.length).toBe(1);
    expect((remaining[0] as { user_id: string }).user_id).toBe("user_b");
  });
});

describe("markDomainSensitive — idempotence + scoping (W9)", () => {
  let dbPath: string;
  let db: Client;

  beforeEach(async () => {
    dbPath = tempDbPath();
    db = createClient({ url: "file:" + dbPath });
    await setup(db);
  });
  afterEach(() => {
    try { db.close(); } catch { /* noop */ }
    for (const suffix of ["", "-wal", "-shm"]) {
      const p = dbPath + suffix;
      if (existsSync(p)) try { unlinkSync(p); } catch { /* noop */ }
    }
  });

  async function markSensitive(userId: string | null, domain: string, sensitive: boolean) {
    const uf = userFilter(userId);
    if (sensitive) {
      await db.execute({
        sql: `INSERT INTO sensitive_domains (user_id, domain, marked_at) VALUES (?, ?, ?)
              ON CONFLICT DO NOTHING`,
        args: [userId, domain, new Date().toISOString()],
      });
    } else {
      await db.execute({
        sql: `DELETE FROM sensitive_domains WHERE domain = ?${uf.clause}`,
        args: [domain, ...uf.args],
      });
    }
  }

  it("marking the same domain twice produces exactly one row", async () => {
    await markSensitive(null, "finance", true);
    await markSensitive(null, "finance", true);
    const n = (await db.execute({
      sql: `SELECT COUNT(*) as c FROM sensitive_domains WHERE domain = 'finance'`,
      args: [],
    })).rows[0] as { c: number };
    expect(n.c).toBe(1);
  });

  it("unmarking removes only the caller's row when two users share a domain", async () => {
    await markSensitive("user_a", "finance", true);
    await markSensitive("user_b", "finance", true);
    await markSensitive("user_a", "finance", false);

    const remaining = (await db.execute({
      sql: `SELECT user_id FROM sensitive_domains WHERE domain = 'finance'`,
      args: [],
    })).rows.map(r => (r as { user_id: string }).user_id);
    expect(remaining).toEqual(["user_b"]);
  });

  it("unmarking a domain that wasn't marked is a no-op (no error)", async () => {
    await expect(markSensitive(null, "never-marked", false)).resolves.toBeUndefined();
  });

  it("IFNULL(user_id, '') unique index collapses local-mode NULL tenancy", async () => {
    await markSensitive(null, "finance", true);
    // Second INSERT with NULL userId should be deduped by the unique
    // index; without the IFNULL trick SQLite would treat each NULL
    // as distinct and allow duplicates.
    await expect(
      db.execute({
        sql: `INSERT INTO sensitive_domains (user_id, domain, marked_at) VALUES (NULL, 'finance', ?)
              ON CONFLICT DO NOTHING`,
        args: [new Date().toISOString()],
      }),
    ).resolves.toBeDefined();
    const n = (await db.execute({
      sql: `SELECT COUNT(*) as c FROM sensitive_domains WHERE domain = 'finance'`,
      args: [],
    })).rows[0] as { c: number };
    expect(n.c).toBe(1);
  });
});

describe("agent_permissions unique index (W2)", () => {
  let dbPath: string;
  let db: Client;

  beforeEach(async () => {
    dbPath = tempDbPath();
    db = createClient({ url: "file:" + dbPath });
    await setup(db);
  });
  afterEach(() => {
    try { db.close(); } catch { /* noop */ }
    for (const suffix of ["", "-wal", "-shm"]) {
      const p = dbPath + suffix;
      if (existsSync(p)) try { unlinkSync(p); } catch { /* noop */ }
    }
  });

  it("concurrent INSERT ... ON CONFLICT for the same wildcard row converges to one row", async () => {
    // Two "setAgentMode isolated" clicks racing.
    await Promise.all([
      db.execute({
        sql: `INSERT INTO agent_permissions (agent_id, domain, can_read, can_write, user_id)
              VALUES (?, '*', 0, 0, ?)
              ON CONFLICT DO UPDATE SET can_read = 0, can_write = 0`,
        args: ["agent_x", null],
      }),
      db.execute({
        sql: `INSERT INTO agent_permissions (agent_id, domain, can_read, can_write, user_id)
              VALUES (?, '*', 0, 0, ?)
              ON CONFLICT DO UPDATE SET can_read = 0, can_write = 0`,
        args: ["agent_x", null],
      }),
    ]);
    const rows = await db.execute({
      sql: `SELECT COUNT(*) as c FROM agent_permissions WHERE agent_id = ? AND domain = '*'`,
      args: ["agent_x"],
    });
    expect((rows.rows[0] as { c: number }).c).toBe(1);
  });

  it("toggle blockDomain→allowDomain flips can_read/can_write without duplicate rows", async () => {
    // blockDomain
    await db.execute({
      sql: `INSERT INTO agent_permissions (agent_id, domain, can_read, can_write, user_id)
            VALUES (?, ?, 0, 0, ?)
            ON CONFLICT DO UPDATE SET can_read = 0, can_write = 0`,
      args: ["agent_x", "work", null],
    });
    // allowDomain
    await db.execute({
      sql: `INSERT INTO agent_permissions (agent_id, domain, can_read, can_write, user_id)
            VALUES (?, ?, 1, 1, ?)
            ON CONFLICT DO UPDATE SET can_read = 1, can_write = 1`,
      args: ["agent_x", "work", null],
    });
    const rows = (await db.execute({
      sql: `SELECT can_read, can_write FROM agent_permissions WHERE agent_id = 'agent_x' AND domain = 'work'`,
      args: [],
    })).rows;
    expect(rows.length).toBe(1);
    expect(rows[0]).toEqual(expect.objectContaining({ can_read: 1, can_write: 1 }));
  });
});
