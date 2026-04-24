import type { Client } from "@libsql/client";

// 1 leading letter + 0–62 alnum/hyphen = 63 chars max.
export const DOMAIN_NAME_RE = /^[a-z][a-z0-9-]{0,62}$/;

export interface DomainRow {
  name: string;
  description: string | null;
  parentName: string | null;
  archived: boolean;
  archivedAt: string | null;
  createdAt: string;
  userId: string | null;
}

export interface RegisterDomainInput {
  name: string;
  description?: string;
  parentName?: string;
  userId?: string | null;
}

export interface ArchiveDomainInput {
  name: string;
  reason?: string;
  userId?: string | null;
  /**
   * Optional logger for audit side-effects. Kept behind a caller-supplied hook
   * so `@lodis/core` stays portable across runtimes that don't expose
   * Node's `process` (Workers, Deno, Bun). MCP server injects a stderr logger.
   */
  log?: (msg: string) => void;
}

interface DomainDbRow {
  name: string;
  description: string | null;
  parent_name: string | null;
  archived: number;
  archived_at: string | null;
  created_at: string;
  user_id: string | null;
}

function toRow(r: DomainDbRow): DomainRow {
  return {
    name: r.name,
    description: r.description,
    parentName: r.parent_name,
    archived: r.archived === 1,
    archivedAt: r.archived_at,
    createdAt: r.created_at,
    userId: r.user_id,
  };
}

export function validateDomainName(name: string): string | null {
  if (typeof name !== "string" || name.length === 0) {
    return "Domain name must be a non-empty string.";
  }
  // The regex enforces both the character class and the 63-char upper bound.
  // We keep a dedicated "too long" branch so the returned message is actionable
  // for the common "typed too many characters" case rather than a regex dump.
  if (name.length > 63) {
    return "Domain name must be 63 characters or fewer.";
  }
  if (!DOMAIN_NAME_RE.test(name)) {
    return `Domain name "${name}" is invalid. Must match ${DOMAIN_NAME_RE} (lowercase, start with a letter, letters/digits/hyphens only).`;
  }
  return null;
}

export async function getDomain(
  client: Client,
  name: string,
  userId?: string | null,
): Promise<DomainRow | null> {
  const rows = (await client.execute({
    sql: `SELECT name, description, parent_name, archived, archived_at, created_at, user_id
          FROM domains
          WHERE name = ? AND IFNULL(user_id, '') = IFNULL(?, '')
          LIMIT 1`,
    args: [name, userId ?? null],
  })).rows as unknown as DomainDbRow[];
  return rows.length > 0 ? toRow(rows[0]) : null;
}

export async function isDomainRegistered(
  client: Client,
  name: string,
  userId?: string | null,
): Promise<boolean> {
  const row = await getDomain(client, name, userId);
  return row !== null;
}

export async function isDomainArchived(
  client: Client,
  name: string,
  userId?: string | null,
): Promise<boolean> {
  const row = await getDomain(client, name, userId);
  return row?.archived === true;
}

export async function registerDomain(
  client: Client,
  input: RegisterDomainInput,
): Promise<{ status: "created" | "unarchived" | "noop"; row: DomainRow }> {
  const err = validateDomainName(input.name);
  if (err) throw new Error(err);

  if (input.parentName !== undefined && input.parentName !== null) {
    const parentErr = validateDomainName(input.parentName);
    if (parentErr) throw new Error(`Invalid parent_name: ${parentErr}`);
    const parent = await getDomain(client, input.parentName, input.userId ?? null);
    if (!parent) {
      throw new Error(`Parent domain "${input.parentName}" does not exist. Register it first.`);
    }
  }

  const existing = await getDomain(client, input.name, input.userId ?? null);
  if (existing) {
    if (existing.archived) {
      await client.execute({
        sql: `UPDATE domains SET archived = 0, archived_at = NULL
              WHERE name = ? AND IFNULL(user_id, '') = IFNULL(?, '')`,
        args: [input.name, input.userId ?? null],
      });
      const row = await getDomain(client, input.name, input.userId ?? null);
      return { status: "unarchived", row: row! };
    }
    return { status: "noop", row: existing };
  }

  // `INSERT OR IGNORE` makes the SELECT→INSERT sequence idempotent under
  // concurrent callers — a racing insert would otherwise raise UNIQUE on
  // idx_domains_name_user. If the ignore path fires (rowsAffected=0), a
  // sibling call already created the row, so we treat this call as noop.
  const insertRes = await client.execute({
    sql: `INSERT OR IGNORE INTO domains (name, description, parent_name, archived, archived_at, created_at, user_id)
          VALUES (?, ?, ?, 0, NULL, ?, ?)`,
    args: [
      input.name,
      input.description ?? null,
      input.parentName ?? null,
      new Date().toISOString(),
      input.userId ?? null,
    ],
  });

  const row = await getDomain(client, input.name, input.userId ?? null);
  if (insertRes.rowsAffected === 0) {
    return { status: "noop", row: row! };
  }
  return { status: "created", row: row! };
}

export async function archiveDomain(
  client: Client,
  input: ArchiveDomainInput,
): Promise<{ status: "archived" | "noop"; row: DomainRow | null }> {
  const err = validateDomainName(input.name);
  if (err) throw new Error(err);

  const existing = await getDomain(client, input.name, input.userId ?? null);
  if (!existing) {
    return { status: "noop", row: null };
  }
  if (existing.archived) {
    return { status: "noop", row: existing };
  }

  await client.execute({
    sql: `UPDATE domains SET archived = 1, archived_at = ?
          WHERE name = ? AND IFNULL(user_id, '') = IFNULL(?, '')`,
    args: [new Date().toISOString(), input.name, input.userId ?? null],
  });

  if (input.reason && input.log) {
    // Strip newlines / control chars and cap length to defeat log injection.
    const safeReason = input.reason.replace(/[\r\n\x00-\x1f\x7f]/g, " ").slice(0, 200);
    input.log(`[lodis] domain_archived: name=${input.name} reason=${safeReason}`);
  }

  const row = await getDomain(client, input.name, input.userId ?? null);
  return { status: "archived", row };
}

export async function listDomains(
  client: Client,
  opts: { includeArchived?: boolean; userId?: string | null } = {},
): Promise<DomainRow[]> {
  const userFilter = opts.userId !== undefined
    ? ` AND IFNULL(user_id, '') = IFNULL(?, '')`
    : ``;
  const archivedFilter = opts.includeArchived ? `` : ` AND archived = 0`;
  const args: (string | null)[] = [];
  if (opts.userId !== undefined) args.push(opts.userId ?? null);
  const rows = (await client.execute({
    sql: `SELECT name, description, parent_name, archived, archived_at, created_at, user_id
          FROM domains
          WHERE 1=1${archivedFilter}${userFilter}
          ORDER BY name`,
    args,
  })).rows as unknown as DomainDbRow[];
  return rows.map(toRow);
}

/**
 * Seed the domains registry from distinct domain values already present in the
 * memories table. Only slug-valid names (per DOMAIN_NAME_RE) are seeded;
 * non-matching legacy values remain as orphans in memory_list_domains
 * (documented as D8 in the plan). Idempotent — per-row `INSERT OR IGNORE`
 * protects against repeat runs. Filtering is done in JS rather than SQLite
 * GLOB because GLOB's `*` wildcard is not class-restricted; the strict regex
 * cannot be expressed in GLOB alone.
 */
export async function seedDomainsFromMemories(client: Client): Promise<number> {
  const rows = (await client.execute({
    sql: `SELECT DISTINCT LOWER(domain) AS name, user_id FROM memories WHERE domain IS NOT NULL`,
    args: [],
  })).rows as unknown as { name: string; user_id: string | null }[];

  const nowIso = new Date().toISOString();
  let added = 0;
  for (const r of rows) {
    if (!DOMAIN_NAME_RE.test(r.name)) continue;
    const res = await client.execute({
      sql: `INSERT OR IGNORE INTO domains (name, created_at, user_id) VALUES (?, ?, ?)`,
      args: [r.name, nowIso, r.user_id],
    });
    if (res.rowsAffected > 0) added++;
  }
  return added;
}
