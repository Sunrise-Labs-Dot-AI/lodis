import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { resolve } from "path";
import { randomBytes } from "crypto";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "@engrams/core";
import { startHttpApi } from "../http.js";

function tempDbPath(): string {
  return resolve(tmpdir(), `engrams-http-test-${randomBytes(8).toString("hex")}.db`);
}

const USER_A = "user_aaa";
const USER_B = "user_bbb";
const MEM_A = "aaaa0000aaaa0000aaaa0000aaaa0000";
const MEM_B = "bbbb0000bbbb0000bbbb0000bbbb0000";

async function post(baseUrl: string, path: string, body?: Record<string, unknown>): Promise<{ status: number; data: Record<string, unknown> }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  return { status: res.status, data };
}

async function del(baseUrl: string, path: string, body: Record<string, unknown>): Promise<{ status: number; data: Record<string, unknown> }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return { status: res.status, data };
}

// Minimal table setup — just what http.ts needs, no vec/FTS
const SETUP_SQL = `
  CREATE TABLE IF NOT EXISTS memories (
    id TEXT PRIMARY KEY,
    content TEXT NOT NULL,
    detail TEXT,
    domain TEXT NOT NULL DEFAULT 'general',
    source_agent_id TEXT NOT NULL,
    source_agent_name TEXT NOT NULL,
    cross_agent_id TEXT,
    cross_agent_name TEXT,
    source_type TEXT NOT NULL,
    source_description TEXT,
    confidence REAL NOT NULL DEFAULT 0.7,
    confirmed_count INTEGER NOT NULL DEFAULT 0,
    corrected_count INTEGER NOT NULL DEFAULT 0,
    mistake_count INTEGER NOT NULL DEFAULT 0,
    used_count INTEGER NOT NULL DEFAULT 0,
    learned_at TEXT,
    confirmed_at TEXT,
    last_used_at TEXT,
    deleted_at TEXT,
    has_pii_flag INTEGER NOT NULL DEFAULT 0,
    entity_type TEXT,
    entity_name TEXT,
    structured_data TEXT,
    summary TEXT,
    permanence TEXT,
    expires_at TEXT,
    archived_at TEXT,
    user_id TEXT,
    updated_at TEXT
  );

  CREATE TABLE IF NOT EXISTS memory_events (
    id TEXT PRIMARY KEY,
    memory_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    agent_id TEXT,
    agent_name TEXT,
    old_value TEXT,
    new_value TEXT,
    timestamp TEXT NOT NULL,
    user_id TEXT
  );

  CREATE TABLE IF NOT EXISTS agent_permissions (
    agent_id TEXT NOT NULL,
    domain TEXT NOT NULL,
    can_read INTEGER NOT NULL DEFAULT 1,
    can_write INTEGER NOT NULL DEFAULT 1,
    user_id TEXT
  );

  CREATE TABLE IF NOT EXISTS engrams_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`;

describe("HTTP API multi-tenant isolation", () => {
  let dbPath: string;
  let serverA: Server;
  let serverB: Server;
  let baseA: string;
  let baseB: string;
  let client: ReturnType<typeof createClient>;

  beforeAll(async () => {
    dbPath = tempDbPath();
    client = createClient({ url: "file:" + dbPath });
    await client.executeMultiple(SETUP_SQL);

    const db = drizzle(client, { schema });
    await client.execute({
      sql: `INSERT INTO memories (id, content, domain, source_agent_id, source_agent_name, source_type, confidence, confirmed_count, corrected_count, mistake_count, used_count, learned_at, user_id)
            VALUES (?, ?, 'general', 'test', 'test-agent', 'stated', 0.8, 0, 0, 0, 0, datetime('now'), ?)`,
      args: [MEM_A, "User A memory", USER_A],
    });
    await client.execute({
      sql: `INSERT INTO memories (id, content, domain, source_agent_id, source_agent_name, source_type, confidence, confirmed_count, corrected_count, mistake_count, used_count, learned_at, user_id)
            VALUES (?, ?, 'general', 'test', 'test-agent', 'stated', 0.8, 0, 0, 0, 0, datetime('now'), ?)`,
      args: [MEM_B, "User B memory", USER_B],
    });
    await client.execute({
      sql: `INSERT INTO agent_permissions (agent_id, domain, can_read, can_write, user_id) VALUES (?, ?, 1, 1, ?)`,
      args: ["agent-1", "work", USER_A],
    });
    await client.execute({
      sql: `INSERT INTO agent_permissions (agent_id, domain, can_read, can_write, user_id) VALUES (?, ?, 1, 1, ?)`,
      args: ["agent-1", "work", USER_B],
    });

    serverA = startHttpApi(db, client, 0, USER_A);
    const waitA = new Promise<void>((r) => serverA.once("listening", r));
    serverB = startHttpApi(db, client, 0, USER_B);
    const waitB = new Promise<void>((r) => serverB.once("listening", r));
    await Promise.all([waitA, waitB]);

    const portA = (serverA.address() as AddressInfo).port;
    const portB = (serverB.address() as AddressInfo).port;
    baseA = `http://127.0.0.1:${portA}`;
    baseB = `http://127.0.0.1:${portB}`;
  });

  afterAll(async () => {
    await new Promise<void>((r) => serverA.close(() => r()));
    await new Promise<void>((r) => serverB.close(() => r()));
    try {
      if (existsSync(dbPath)) unlinkSync(dbPath);
      if (existsSync(dbPath + "-wal")) unlinkSync(dbPath + "-wal");
      if (existsSync(dbPath + "-shm")) unlinkSync(dbPath + "-shm");
    } catch { /* cleanup best-effort */ }
  });

  describe("confirm", () => {
    it("user A can confirm own memory", async () => {
      const { status, data } = await post(baseA, `/api/memory/${MEM_A}/confirm`);
      expect(status).toBe(200);
      expect(data.newConfidence).toBe(0.99);
    });

    it("user A cannot confirm user B memory", async () => {
      const { status } = await post(baseA, `/api/memory/${MEM_B}/confirm`);
      expect(status).toBe(404);
    });
  });

  describe("correct", () => {
    it("user A can correct own memory", async () => {
      const { status, data } = await post(baseA, `/api/memory/${MEM_A}/correct`, { content: "Updated A" });
      expect(status).toBe(200);
      expect(data.newConfidence).toBe(0.5);
    });

    it("user A cannot correct user B memory", async () => {
      const { status } = await post(baseA, `/api/memory/${MEM_B}/correct`, { content: "Hijack" });
      expect(status).toBe(404);
    });
  });

  describe("flag", () => {
    it("user A can flag own memory", async () => {
      const { status, data } = await post(baseA, `/api/memory/${MEM_A}/flag`);
      expect(status).toBe(200);
      // confidence was 0.5 after correct, so 0.5 - 0.15 = 0.35
      expect(data.newConfidence).toBe(0.35);
    });

    it("user A cannot flag user B memory", async () => {
      const { status } = await post(baseA, `/api/memory/${MEM_B}/flag`);
      expect(status).toBe(404);
    });
  });

  describe("update", () => {
    it("user A can update own memory", async () => {
      const { status, data } = await post(baseA, `/api/memory/${MEM_A}/update`, { content: "New content A" });
      expect(status).toBe(200);
      expect(data.updated).toBe(true);
      const row = await client.execute({ sql: `SELECT content FROM memories WHERE id = ?`, args: [MEM_A] });
      expect(row.rows[0].content).toBe("New content A");
    });

    it("user A cannot update user B memory", async () => {
      await post(baseA, `/api/memory/${MEM_B}/update`, { content: "Hijack" });
      const row = await client.execute({ sql: `SELECT content FROM memories WHERE id = ?`, args: [MEM_B] });
      expect(row.rows[0].content).toBe("User B memory");
    });
  });

  describe("delete", () => {
    it("user A cannot delete user B memory", async () => {
      await post(baseA, `/api/memory/${MEM_B}/delete`);
      const row = await client.execute({ sql: `SELECT deleted_at FROM memories WHERE id = ?`, args: [MEM_B] });
      expect(row.rows[0].deleted_at).toBeNull();
    });

    it("user A can delete own memory", async () => {
      const { status, data } = await post(baseA, `/api/memory/${MEM_A}/delete`);
      expect(status).toBe(200);
      expect(data.deleted).toBe(true);
    });
  });

  describe("permissions", () => {
    it("user A creates permission scoped to self", async () => {
      const { status, data } = await post(baseA, "/api/permissions", {
        agentId: "new-agent",
        domain: "personal",
      });
      expect(status).toBe(200);
      expect(data.canRead).toBe(true);
      const row = await client.execute({
        sql: `SELECT user_id FROM agent_permissions WHERE agent_id = ? AND domain = ?`,
        args: ["new-agent", "personal"],
      });
      expect(row.rows[0].user_id).toBe(USER_A);
    });

    it("user A cannot delete user B permissions", async () => {
      const { status } = await del(baseA, "/api/permissions", {
        agentId: "agent-1",
        domain: "work",
      });
      expect(status).toBe(200);
      // B's permission should still exist
      const row = await client.execute({
        sql: `SELECT COUNT(*) as cnt FROM agent_permissions WHERE agent_id = ? AND domain = ? AND user_id = ?`,
        args: ["agent-1", "work", USER_B],
      });
      expect(Number(row.rows[0].cnt)).toBe(1);
    });
  });

  describe("clear-all", () => {
    it("clears only own memories", async () => {
      // Seed a fresh memory for user B to clear-all on
      const freshB = "cccc0000cccc0000cccc0000cccc0000";
      await client.execute({
        sql: `INSERT INTO memories (id, content, domain, source_agent_id, source_agent_name, source_type, confidence, confirmed_count, corrected_count, mistake_count, used_count, learned_at, user_id)
              VALUES (?, ?, 'general', 'test', 'test-agent', 'stated', 0.8, 0, 0, 0, 0, datetime('now'), ?)`,
        args: [freshB, "Fresh B memory", USER_B],
      });

      const { status } = await post(baseB, "/api/clear-all");
      expect(status).toBe(200);

      // B's memories should be deleted
      const bRow = await client.execute({ sql: `SELECT deleted_at FROM memories WHERE id = ?`, args: [freshB] });
      expect(bRow.rows[0].deleted_at).not.toBeNull();

      // A's original memory (already deleted by earlier test) — check MEM_B was also cleared since it's B's
      const origB = await client.execute({ sql: `SELECT deleted_at FROM memories WHERE id = ?`, args: [MEM_B] });
      expect(origB.rows[0].deleted_at).not.toBeNull();
    });
  });
});
