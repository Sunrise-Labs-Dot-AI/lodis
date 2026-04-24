import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { resolve } from "path";
import { randomBytes } from "crypto";
import { createDatabase } from "../db.js";
import type { Client } from "@libsql/client";
import {
  validateDomainName,
  registerDomain,
  archiveDomain,
  isDomainRegistered,
  isDomainArchived,
  getDomain,
  listDomains,
  seedDomainsFromMemories,
} from "../domains.js";

function tempDbPath(): string {
  return resolve(tmpdir(), `lodis-domains-${randomBytes(8).toString("hex")}.db`);
}

describe("validateDomainName", () => {
  it("accepts slug-valid names", () => {
    expect(validateDomainName("fitness")).toBeNull();
    expect(validateDomainName("sunrise-labs")).toBeNull();
    expect(validateDomainName("a")).toBeNull();
    expect(validateDomainName("a" + "b".repeat(62))).toBeNull(); // 63 chars
  });

  it("rejects invalid names with specific errors", () => {
    expect(validateDomainName("Fitness")).toMatch(/invalid/i);
    expect(validateDomainName("fit ness")).toMatch(/invalid/i);
    expect(validateDomainName("-fit")).toMatch(/invalid/i);
    expect(validateDomainName("fit/ness")).toMatch(/invalid/i);
    expect(validateDomainName("")).toMatch(/non-empty/i);
    expect(validateDomainName("a" + "b".repeat(63))).toMatch(/63 characters/i);
  });
});

describe("domain registry", () => {
  let dbPath: string;
  let client: Client;

  beforeEach(async () => {
    dbPath = tempDbPath();
    const res = await createDatabase({ url: "file:" + dbPath });
    client = res.client;
  });

  afterEach(() => {
    try { client.close(); } catch { /* already closed */ }
    try {
      for (const suffix of ["", "-wal", "-shm"]) {
        const p = dbPath + suffix;
        if (existsSync(p)) unlinkSync(p);
      }
    } catch { /* best-effort */ }
  });

  it("registerDomain creates a new row", async () => {
    const r = await registerDomain(client, { name: "advisory" });
    expect(r.status).toBe("created");
    expect(r.row.name).toBe("advisory");
    expect(r.row.archived).toBe(false);

    expect(await isDomainRegistered(client, "advisory")).toBe(true);
    expect(await isDomainArchived(client, "advisory")).toBe(false);
  });

  it("registerDomain is idempotent on duplicates", async () => {
    await registerDomain(client, { name: "advisory" });
    const r = await registerDomain(client, { name: "advisory" });
    expect(r.status).toBe("noop");
  });

  it("archiveDomain archives, and a second archive call is a noop", async () => {
    await registerDomain(client, { name: "atlas" });
    const r1 = await archiveDomain(client, { name: "atlas" });
    expect(r1.status).toBe("archived");
    expect(r1.row?.archived).toBe(true);
    expect(await isDomainArchived(client, "atlas")).toBe(true);

    const r2 = await archiveDomain(client, { name: "atlas" });
    expect(r2.status).toBe("noop");
  });

  it("archiveDomain on an unknown name returns noop with null row", async () => {
    const r = await archiveDomain(client, { name: "never-existed" });
    expect(r.status).toBe("noop");
    expect(r.row).toBeNull();
  });

  it("registerDomain on an archived name unarchives it", async () => {
    await registerDomain(client, { name: "atlas" });
    await archiveDomain(client, { name: "atlas" });
    const r = await registerDomain(client, { name: "atlas" });
    expect(r.status).toBe("unarchived");
    expect(r.row.archived).toBe(false);
  });

  it("registerDomain rejects invalid slugs", async () => {
    await expect(registerDomain(client, { name: "Fitness" })).rejects.toThrow(/invalid/i);
  });

  it("registerDomain validates parent_name exists", async () => {
    await expect(
      registerDomain(client, { name: "child", parentName: "nonexistent" }),
    ).rejects.toThrow(/does not exist/i);

    await registerDomain(client, { name: "parent" });
    const r = await registerDomain(client, { name: "child", parentName: "parent" });
    expect(r.status).toBe("created");
    expect(r.row.parentName).toBe("parent");
  });

  it("listDomains respects includeArchived", async () => {
    await registerDomain(client, { name: "work" });
    await registerDomain(client, { name: "atlas" });
    await archiveDomain(client, { name: "atlas" });

    const visible = await listDomains(client, {});
    expect(visible.map((d) => d.name).sort()).toEqual(["work"]);

    const all = await listDomains(client, { includeArchived: true });
    expect(all.map((d) => d.name).sort()).toEqual(["atlas", "work"]);
  });

  it("seedDomainsFromMemories seeds slug-valid domains and skips invalid ones", async () => {
    // Insert memories with mixed domain casing/validity. userId NULL for all.
    await client.execute({
      sql: `INSERT INTO memories (id, content, domain, source_agent_id, source_agent_name, source_type, confidence, learned_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [randomBytes(16).toString("hex"), "a", "fitness", "test", "Test", "observed", 0.8, new Date().toISOString()],
    });
    await client.execute({
      sql: `INSERT INTO memories (id, content, domain, source_agent_id, source_agent_name, source_type, confidence, learned_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [randomBytes(16).toString("hex"), "b", "Fitness", "test", "Test", "observed", 0.8, new Date().toISOString()],
    });
    await client.execute({
      sql: `INSERT INTO memories (id, content, domain, source_agent_id, source_agent_name, source_type, confidence, learned_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [randomBytes(16).toString("hex"), "c", "health/fitness", "test", "Test", "observed", 0.8, new Date().toISOString()],
    });

    const added = await seedDomainsFromMemories(client);
    expect(added).toBeGreaterThanOrEqual(1);
    // LOWER("Fitness") = "fitness" which is slug-valid, so it gets seeded as "fitness".
    // "health/fitness" lowercased still has a slash → excluded by GLOB.
    expect(await isDomainRegistered(client, "fitness")).toBe(true);
    expect(await getDomain(client, "health/fitness")).toBeNull();
  });
});
