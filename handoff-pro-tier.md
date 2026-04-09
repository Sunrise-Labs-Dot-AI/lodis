# Handoff: Pro Tier — Cloud Sync, Encryption, Auth, Hosted Dashboard

**Repo:** `Sunrise-Labs-Dot-AI/engrams` (local at `~/Documents/Claude/Projects/engrams`)
**Branch:** `main`
**Budget:** $25
**Timeout:** 60 min

## Context

Engrams V2 is feature complete for the free tier (local-only). This handoff builds the Pro tier: cloud sync across devices, end-to-end encryption, user authentication, and a Vercel-hosted dashboard.

Read `CLAUDE.md` in the repo root for full project context.

**Current architecture:**
- SQLite at `~/.engrams/engrams.db` via better-sqlite3
- MCP server on stdio transport
- Dashboard at localhost:3838 via Next.js dev server
- No auth, no encryption, no cloud
- Drizzle ORM schema in `packages/core/src/schema.ts`
- Database init in `packages/core/src/db.ts` — `createDatabase()` returns `{ db, sqlite, vecAvailable }`
- Dashboard reads SQLite directly via `getReadDb()` in `packages/dashboard/src/lib/db.ts`
- Settings page exists at `packages/dashboard/src/app/settings/page.tsx` with db stats

**Key decision from architecture doc:** Turso embedded replicas for sync, scrypt key derivation for encryption, Clerk for auth. This handoff implements all three.

## Overview

The Pro tier adds four capabilities:

1. **Encryption** — AES-256-GCM with scrypt KDF. Memories encrypted before sync. Local-only users unaffected.
2. **Cloud sync** — Turso (libSQL) embedded replicas. Local reads, cloud writes. Offline-capable.
3. **Auth** — Clerk for the hosted dashboard. API key for MCP server cloud features.
4. **Hosted dashboard** — Vercel deployment reading from Turso, gated by Clerk auth.

Build order matters: encryption first (no cloud dependency), then sync (needs encryption), then auth + hosted dashboard (needs sync).

## Part 1: Encryption Layer

Create `packages/core/src/crypto.ts`:

```typescript
import { randomBytes, scryptSync, createCipheriv, createDecipheriv } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const SCRYPT_N = 131072;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 32;

export interface EncryptionKeys {
  encryptionKey: Buffer;
  hmacKey: Buffer; // For deterministic content hashing (dedup in cloud)
}

/**
 * Derive encryption and HMAC keys from a user passphrase + salt.
 * Salt should be generated once per device and stored in credentials.json.
 */
export function deriveKeys(passphrase: string, salt: Buffer): EncryptionKeys {
  // Derive 64 bytes: first 32 for encryption, last 32 for HMAC
  const derived = scryptSync(passphrase, salt, KEY_LENGTH * 2, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return {
    encryptionKey: derived.subarray(0, KEY_LENGTH),
    hmacKey: derived.subarray(KEY_LENGTH),
  };
}

/**
 * Generate a random salt for key derivation. Store this per-device.
 */
export function generateSalt(): Buffer {
  return randomBytes(32);
}

/**
 * Encrypt plaintext. Returns base64(IV + ciphertext + authTag).
 * Each call uses a fresh random IV — safe for multiple encryptions with same key.
 */
export function encrypt(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, encrypted, authTag]).toString("base64");
}

/**
 * Decrypt base64(IV + ciphertext + authTag) back to plaintext.
 */
export function decrypt(encoded: string, key: Buffer): string {
  const data = Buffer.from(encoded, "base64");
  const iv = data.subarray(0, IV_LENGTH);
  const authTag = data.subarray(data.length - AUTH_TAG_LENGTH);
  const ciphertext = data.subarray(IV_LENGTH, data.length - AUTH_TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(ciphertext) + decipher.final("utf8");
}

/**
 * Encrypt a memory record's sensitive fields for cloud sync.
 * Non-sensitive metadata (id, timestamps, domain, entity_type) stays cleartext.
 */
export function encryptMemory(
  memory: { content: string; detail: string | null; structured_data: string | null },
  key: Buffer,
): { content: string; detail: string | null; structured_data: string | null } {
  return {
    content: encrypt(memory.content, key),
    detail: memory.detail ? encrypt(memory.detail, key) : null,
    structured_data: memory.structured_data ? encrypt(memory.structured_data, key) : null,
  };
}

/**
 * Decrypt a memory record's sensitive fields after sync pull.
 */
export function decryptMemory(
  memory: { content: string; detail: string | null; structured_data: string | null },
  key: Buffer,
): { content: string; detail: string | null; structured_data: string | null } {
  return {
    content: decrypt(memory.content, key),
    detail: memory.detail ? decrypt(memory.detail, key) : null,
    structured_data: memory.structured_data ? decrypt(memory.structured_data, key) : null,
  };
}
```

Export from `packages/core/src/index.ts`.

### Credentials file

Create `packages/core/src/credentials.ts`:

```typescript
import { resolve } from "path";
import { homedir } from "os";
import { readFileSync, writeFileSync, existsSync, chmodSync } from "fs";
import { randomBytes, randomUUID } from "crypto";

const CRED_PATH = resolve(homedir(), ".engrams", "credentials.json");

export interface Credentials {
  deviceId: string;
  salt: string; // base64 encoded
  apiKey?: string; // Pro tier cloud API key
  tursoUrl?: string;
  tursoAuthToken?: string;
  passphraseHash?: string; // scrypt hash to verify passphrase on entry, NOT the key itself
}

export function loadCredentials(): Credentials | null {
  if (!existsSync(CRED_PATH)) return null;
  try {
    return JSON.parse(readFileSync(CRED_PATH, "utf8"));
  } catch {
    return null;
  }
}

export function saveCredentials(creds: Credentials): void {
  writeFileSync(CRED_PATH, JSON.stringify(creds, null, 2), "utf8");
  try { chmodSync(CRED_PATH, 0o600); } catch { /* non-critical */ }
}

export function initCredentials(): Credentials {
  const existing = loadCredentials();
  if (existing) return existing;

  const creds: Credentials = {
    deviceId: randomUUID(),
    salt: randomBytes(32).toString("base64"),
  };
  saveCredentials(creds);
  return creds;
}
```

### Tests

Add `packages/core/src/__tests__/crypto.test.ts`:
- encrypt/decrypt roundtrip
- Different IVs produce different ciphertexts for same plaintext
- Wrong key fails to decrypt (throws)
- deriveKeys produces consistent output for same passphrase+salt
- deriveKeys produces different output for different passphrases
- encryptMemory/decryptMemory roundtrip with null fields
- generateSalt produces 32 bytes

## Part 2: Cloud Sync via Turso

### Dependencies

```bash
cd packages/core && pnpm add @libsql/client
cd packages/mcp-server && pnpm add @libsql/client
```

### Turso setup

The user will need to:
1. Create a Turso account at https://turso.tech
2. Create a database: `turso db create engrams`
3. Get the URL and auth token: `turso db tokens create engrams`
4. Store in credentials.json (via settings page or CLI)

### Sync engine

Create `packages/core/src/sync.ts`:

```typescript
import { createClient, type Client } from "@libsql/client";
import type Database from "better-sqlite3";
import { encryptMemory, decryptMemory, type EncryptionKeys } from "./crypto.js";

export interface SyncConfig {
  tursoUrl: string;
  tursoAuthToken: string;
  keys: EncryptionKeys;
}

export interface SyncResult {
  pushed: number;
  pulled: number;
  conflicts: number;
}

/**
 * Initialize the remote Turso database with the same schema as local.
 * This is idempotent — safe to call on every sync.
 */
export async function initRemoteSchema(client: Client): Promise<void> {
  await client.executeMultiple(`
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
      device_id TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS memory_connections (
      source_memory_id TEXT NOT NULL,
      target_memory_id TEXT NOT NULL,
      relationship TEXT NOT NULL,
      device_id TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
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
      device_id TEXT
    );

    CREATE TABLE IF NOT EXISTS sync_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id TEXT NOT NULL,
      synced_at TEXT NOT NULL DEFAULT (datetime('now')),
      pushed INTEGER NOT NULL DEFAULT 0,
      pulled INTEGER NOT NULL DEFAULT 0
    );
  `);
}

/**
 * Push local changes to Turso. Encrypts sensitive fields before upload.
 * Uses updated_at > last_sync_at to find changed records.
 */
export async function pushChanges(
  sqlite: Database.Database,
  client: Client,
  config: SyncConfig,
  deviceId: string,
): Promise<number> {
  // Get last sync timestamp for this device
  const lastSync = await getLastSyncTime(client, deviceId);

  // Find locally changed memories since last sync
  // We need an updated_at column on the local DB too
  const changedMemories = sqlite.prepare(`
    SELECT * FROM memories WHERE updated_at > ? OR (updated_at IS NULL AND learned_at > ?)
  `).all(lastSync, lastSync) as Record<string, unknown>[];

  let pushed = 0;
  for (const mem of changedMemories) {
    const encrypted = encryptMemory(
      {
        content: mem.content as string,
        detail: mem.detail as string | null,
        structured_data: mem.structured_data as string | null,
      },
      config.keys.encryptionKey,
    );

    await client.execute({
      sql: `INSERT OR REPLACE INTO memories
        (id, content, detail, domain, source_agent_id, source_agent_name,
         cross_agent_id, cross_agent_name, source_type, source_description,
         confidence, confirmed_count, corrected_count, mistake_count, used_count,
         learned_at, confirmed_at, last_used_at, deleted_at,
         has_pii_flag, entity_type, entity_name, structured_data,
         device_id, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      args: [
        mem.id as string, encrypted.content, encrypted.detail,
        mem.domain as string, mem.source_agent_id as string, mem.source_agent_name as string,
        mem.cross_agent_id as string | null, mem.cross_agent_name as string | null,
        mem.source_type as string, mem.source_description as string | null,
        mem.confidence as number,
        mem.confirmed_count as number, mem.corrected_count as number,
        mem.mistake_count as number, mem.used_count as number,
        mem.learned_at as string | null, mem.confirmed_at as string | null,
        mem.last_used_at as string | null, mem.deleted_at as string | null,
        mem.has_pii_flag as number, mem.entity_type as string | null,
        mem.entity_name as string | null, encrypted.structured_data,
        deviceId,
      ],
    });
    pushed++;
  }

  // Push changed connections
  const changedConnections = sqlite.prepare(`
    SELECT * FROM memory_connections WHERE updated_at > ? OR updated_at IS NULL
  `).all(lastSync) as Record<string, unknown>[];

  for (const conn of changedConnections) {
    await client.execute({
      sql: `INSERT OR REPLACE INTO memory_connections
        (source_memory_id, target_memory_id, relationship, device_id, updated_at)
        VALUES (?, ?, ?, ?, datetime('now'))`,
      args: [
        conn.source_memory_id as string, conn.target_memory_id as string,
        conn.relationship as string, deviceId,
      ],
    });
  }

  // Push events (append-only, no conflict)
  const changedEvents = sqlite.prepare(`
    SELECT * FROM memory_events WHERE timestamp > ?
  `).all(lastSync) as Record<string, unknown>[];

  for (const evt of changedEvents) {
    await client.execute({
      sql: `INSERT OR IGNORE INTO memory_events
        (id, memory_id, event_type, agent_id, agent_name, old_value, new_value, timestamp, device_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        evt.id as string, evt.memory_id as string, evt.event_type as string,
        evt.agent_id as string | null, evt.agent_name as string | null,
        evt.old_value as string | null, evt.new_value as string | null,
        evt.timestamp as string, deviceId,
      ],
    });
  }

  return pushed + changedConnections.length + changedEvents.length;
}

/**
 * Pull remote changes from Turso. Decrypts after download.
 * Only pulls changes from OTHER devices (skips own device_id).
 */
export async function pullChanges(
  sqlite: Database.Database,
  client: Client,
  config: SyncConfig,
  deviceId: string,
): Promise<number> {
  const lastSync = await getLastSyncTime(client, deviceId);

  // Pull memories changed by other devices
  const result = await client.execute({
    sql: `SELECT * FROM memories WHERE device_id != ? AND updated_at > ?`,
    args: [deviceId, lastSync],
  });

  let pulled = 0;
  for (const row of result.rows) {
    const decrypted = decryptMemory(
      {
        content: row.content as string,
        detail: row.detail as string | null,
        structured_data: row.structured_data as string | null,
      },
      config.keys.encryptionKey,
    );

    // Last-write-wins: only update if remote is newer
    const local = sqlite.prepare(`SELECT updated_at FROM memories WHERE id = ?`).get(row.id as string) as { updated_at: string } | undefined;
    if (local && local.updated_at >= (row.updated_at as string)) continue;

    sqlite.prepare(`
      INSERT OR REPLACE INTO memories
        (id, content, detail, domain, source_agent_id, source_agent_name,
         cross_agent_id, cross_agent_name, source_type, source_description,
         confidence, confirmed_count, corrected_count, mistake_count, used_count,
         learned_at, confirmed_at, last_used_at, deleted_at,
         has_pii_flag, entity_type, entity_name, structured_data, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      row.id, decrypted.content, decrypted.detail,
      row.domain, row.source_agent_id, row.source_agent_name,
      row.cross_agent_id, row.cross_agent_name,
      row.source_type, row.source_description,
      row.confidence, row.confirmed_count, row.corrected_count,
      row.mistake_count, row.used_count,
      row.learned_at, row.confirmed_at, row.last_used_at, row.deleted_at,
      row.has_pii_flag, row.entity_type, row.entity_name,
      decrypted.structured_data, row.updated_at,
    );
    pulled++;
  }

  // Pull connections from other devices
  const connResult = await client.execute({
    sql: `SELECT * FROM memory_connections WHERE device_id != ? AND updated_at > ?`,
    args: [deviceId, lastSync],
  });
  for (const row of connResult.rows) {
    sqlite.prepare(`
      INSERT OR IGNORE INTO memory_connections (source_memory_id, target_memory_id, relationship, updated_at)
      VALUES (?, ?, ?, ?)
    `).run(row.source_memory_id, row.target_memory_id, row.relationship, row.updated_at);
    pulled++;
  }

  // Pull events from other devices (append-only)
  const evtResult = await client.execute({
    sql: `SELECT * FROM memory_events WHERE device_id != ? AND timestamp > ?`,
    args: [deviceId, lastSync],
  });
  for (const row of evtResult.rows) {
    sqlite.prepare(`
      INSERT OR IGNORE INTO memory_events (id, memory_id, event_type, agent_id, agent_name, old_value, new_value, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(row.id, row.memory_id, row.event_type, row.agent_id, row.agent_name, row.old_value, row.new_value, row.timestamp);
    pulled++;
  }

  return pulled;
}

/**
 * Full sync: push local changes, then pull remote changes, then log.
 */
export async function sync(
  sqlite: Database.Database,
  config: SyncConfig,
  deviceId: string,
): Promise<SyncResult> {
  const client = createClient({
    url: config.tursoUrl,
    authToken: config.tursoAuthToken,
  });

  try {
    await initRemoteSchema(client);
    const pushed = await pushChanges(sqlite, client, config, deviceId);
    const pulled = await pullChanges(sqlite, client, config, deviceId);

    // Log sync
    await client.execute({
      sql: `INSERT INTO sync_log (device_id, pushed, pulled) VALUES (?, ?, ?)`,
      args: [deviceId, pushed, pulled],
    });

    // Update local last_modified to trigger cache invalidation
    sqlite.prepare(`INSERT OR REPLACE INTO engrams_meta (key, value) VALUES ('last_modified', datetime('now'))`).run();

    return { pushed, pulled, conflicts: 0 };
  } finally {
    client.close();
  }
}

async function getLastSyncTime(client: Client, deviceId: string): Promise<string> {
  const result = await client.execute({
    sql: `SELECT synced_at FROM sync_log WHERE device_id = ? ORDER BY synced_at DESC LIMIT 1`,
    args: [deviceId],
  });
  return result.rows.length > 0 ? (result.rows[0].synced_at as string) : "1970-01-01T00:00:00Z";
}
```

### Local schema migration

Add a migration in `packages/core/src/db.ts`:

```typescript
runMigration(sqlite, "add_updated_at", () => {
  sqlite.exec(`ALTER TABLE memories ADD COLUMN updated_at TEXT`);
  // Backfill existing rows
  sqlite.exec(`UPDATE memories SET updated_at = COALESCE(confirmed_at, learned_at, datetime('now')) WHERE updated_at IS NULL`);

  sqlite.exec(`ALTER TABLE memory_connections ADD COLUMN updated_at TEXT`);
  sqlite.exec(`UPDATE memory_connections SET updated_at = datetime('now') WHERE updated_at IS NULL`);
});
```

Also update all write paths in the MCP server to set `updated_at = datetime('now')` when inserting or updating memories and connections. Search for all `INSERT INTO memories` and `UPDATE memories` statements and add the column.

### MCP tool: `memory_sync`

Add to `packages/mcp-server/src/server.ts`:

```typescript
{
  name: "memory_sync",
  description: "Sync memories with cloud. Requires Pro tier setup (passphrase + Turso credentials in ~/.engrams/credentials.json). Push local changes and pull remote changes.",
  inputSchema: {
    type: "object",
    properties: {
      passphrase: {
        type: "string",
        description: "Your encryption passphrase. Required on first sync or after restart."
      }
    },
    required: ["passphrase"]
  }
}
```

Handler:
```typescript
case "memory_sync": {
  const creds = loadCredentials();
  if (!creds?.tursoUrl || !creds?.tursoAuthToken) {
    return textResult({ error: "Cloud sync not configured. Set tursoUrl and tursoAuthToken in ~/.engrams/credentials.json or via the dashboard settings." });
  }

  const salt = Buffer.from(creds.salt, "base64");
  const keys = deriveKeys(args.passphrase, salt);
  const result = await sync(sqlite, { tursoUrl: creds.tursoUrl, tursoAuthToken: creds.tursoAuthToken, keys }, creds.deviceId);
  return textResult({ status: "synced", ...result });
}
```

## Part 3: Clerk Auth for Hosted Dashboard

### Dependencies

```bash
cd packages/dashboard && pnpm add @clerk/nextjs
```

### Environment variables

The hosted dashboard needs these env vars (set in Vercel):

```
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_...
CLERK_SECRET_KEY=sk_live_...
TURSO_DATABASE_URL=libsql://...
TURSO_AUTH_TOKEN=...
ENGRAMS_ENCRYPTION_KEY=... # Server-side key for the hosted tier (different from user passphrase)
```

For local development, these are NOT required — the dashboard continues to work without Clerk when running locally.

### Middleware

Create `packages/dashboard/src/middleware.ts`:

```typescript
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isPublicRoute = createRouteMatcher(["/sign-in(.*)", "/sign-up(.*)", "/api/health"]);

// Only activate Clerk when the env var is present (hosted mode)
const isHosted = !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

export default isHosted
  ? clerkMiddleware(async (auth, request) => {
      if (!isPublicRoute(request)) {
        await auth.protect();
      }
    })
  : function noopMiddleware(_req: Request) {
      // Local mode — no auth
    };

export const config = {
  matcher: ["/((?!_next|.*\\..*).*)"],
};
```

### Layout provider

Update `packages/dashboard/src/app/layout.tsx` — wrap with ClerkProvider only when hosted:

```typescript
import { ClerkProvider } from "@clerk/nextjs";

const isHosted = !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const content = (
    <html lang="en" className="dark">
      <body>
        <Nav />
        <main className="max-w-5xl mx-auto px-4 py-8">{children}</main>
      </body>
    </html>
  );

  return isHosted ? <ClerkProvider>{content}</ClerkProvider> : content;
}
```

### Auth pages

Create `packages/dashboard/src/app/sign-in/[[...sign-in]]/page.tsx`:
```typescript
import { SignIn } from "@clerk/nextjs";
export default function SignInPage() {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <SignIn />
    </div>
  );
}
```

Create `packages/dashboard/src/app/sign-up/[[...sign-up]]/page.tsx`:
```typescript
import { SignUp } from "@clerk/nextjs";
export default function SignUpPage() {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <SignUp />
    </div>
  );
}
```

### User button in nav

Update `packages/dashboard/src/components/nav.tsx` — add UserButton when hosted:

```typescript
import { UserButton } from "@clerk/nextjs";

const isHosted = !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

// In the nav JSX, after the links:
{isHosted && <UserButton />}
```

## Part 4: Hosted Dashboard Data Layer

When running hosted (Vercel), the dashboard can't read from a local SQLite file. It needs to read from Turso, and decrypt the data.

### Dual data source

Create `packages/dashboard/src/lib/db-hosted.ts`:

```typescript
import { createClient } from "@libsql/client";
import { decrypt } from "@engrams/core/crypto";

const isHosted = !!process.env.TURSO_DATABASE_URL;

function getTursoClient() {
  if (!process.env.TURSO_DATABASE_URL || !process.env.TURSO_AUTH_TOKEN) {
    throw new Error("TURSO_DATABASE_URL and TURSO_AUTH_TOKEN required for hosted mode");
  }
  return createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });
}

// In hosted mode, the server holds a key to decrypt memories for display.
// This is the hosted tier key — NOT the user's passphrase-derived key.
// For true zero-knowledge, the browser would need to decrypt client-side.
// This is a pragmatic first version: server decrypts, TLS protects in transit.
function getHostedKey(): Buffer {
  const key = process.env.ENGRAMS_ENCRYPTION_KEY;
  if (!key) throw new Error("ENGRAMS_ENCRYPTION_KEY required for hosted mode");
  return Buffer.from(key, "base64");
}
```

### Data abstraction

Update `packages/dashboard/src/lib/db.ts` to check `isHosted` and delegate:

```typescript
const isHosted = !!process.env.TURSO_DATABASE_URL;

export function getMemories(options: MemoryFilterOptions = {}): { memories: MemoryRow[]; total: number } {
  if (isHosted) {
    return getMemoriesHosted(options); // from db-hosted.ts
  }
  // ... existing SQLite implementation
}
```

Do this for all data access functions: `getMemories`, `getMemoryById`, `getMemoryConnections`, `getGraphData`, `getEntityGraphData`, `getDbStats`, `getSourceTypes`.

**Important:** This is a lot of duplication. A cleaner approach for the first version: create a `DataSource` interface with two implementations (`LocalDataSource` using better-sqlite3, `HostedDataSource` using @libsql/client). But for speed, duplicating the queries with Turso's client is fine — the SQL is identical, only the driver differs.

For the first version, keep it simple: add a `if (isHosted) { ... }` branch at the top of each function. The Turso client returns the same row shapes.

### Mutation handling in hosted mode

Server actions that mutate data (confirm, correct, split, delete, etc.) need to write to Turso in hosted mode. Update `packages/dashboard/src/lib/actions.ts` and `packages/dashboard/src/lib/db-actions.ts` to use the Turso client when `isHosted`.

## Part 5: Settings Page — Sync Setup

Update `packages/dashboard/src/app/settings/page.tsx` to add Pro tier configuration:

```typescript
// New sections on the settings page:

// 1. Encryption
// - "Set passphrase" form (only shown if no passphraseHash in credentials.json)
// - "Change passphrase" button (shown if already set)
// - Warning: "Your passphrase encrypts memories before cloud sync. If you lose it, your cloud data cannot be recovered."

// 2. Cloud Sync
// - Status indicator: "Not configured" / "Connected" / "Last synced: [timestamp]"
// - Turso URL input field
// - Turso auth token input field (masked)
// - "Save & Test Connection" button
// - "Sync Now" button (triggers push + pull)
// - Auto-sync toggle with interval selector (5min, 15min, 30min, 1hr)

// 3. Account (hosted mode only, shown when isHosted)
// - Clerk UserProfile component
// - "Manage subscription" link (future)
```

Create `packages/dashboard/src/app/settings/actions.ts` for the server actions:

```typescript
"use server";

import { loadCredentials, saveCredentials, initCredentials } from "@engrams/core/credentials";
import { deriveKeys } from "@engrams/core/crypto";
import { sync } from "@engrams/core/sync";
import { getReadDb } from "@/lib/db";
import { createClient } from "@libsql/client";
import { scryptSync } from "crypto";

export async function setupPassphrase(passphrase: string): Promise<{ success: boolean; error?: string }> {
  const creds = initCredentials();
  const salt = Buffer.from(creds.salt, "base64");

  // Store a hash of the passphrase for verification (NOT the key)
  const hash = scryptSync(passphrase, salt, 32, { N: 131072, r: 8, p: 1 }).toString("base64");
  creds.passphraseHash = hash;
  saveCredentials(creds);

  return { success: true };
}

export async function saveTursoConfig(url: string, token: string): Promise<{ success: boolean; error?: string }> {
  try {
    // Test connection
    const client = createClient({ url, authToken: token });
    await client.execute("SELECT 1");
    client.close();

    const creds = initCredentials();
    creds.tursoUrl = url;
    creds.tursoAuthToken = token;
    saveCredentials(creds);

    return { success: true };
  } catch (err) {
    return { success: false, error: `Connection failed: ${err instanceof Error ? err.message : "Unknown error"}` };
  }
}

export async function triggerSync(passphrase: string): Promise<{ success: boolean; pushed?: number; pulled?: number; error?: string }> {
  const creds = loadCredentials();
  if (!creds?.tursoUrl || !creds?.tursoAuthToken) {
    return { success: false, error: "Cloud sync not configured" };
  }

  const salt = Buffer.from(creds.salt, "base64");
  const keys = deriveKeys(passphrase, salt);
  const sqlite = getReadDb();

  try {
    const result = await sync(sqlite, {
      tursoUrl: creds.tursoUrl,
      tursoAuthToken: creds.tursoAuthToken,
      keys,
    }, creds.deviceId);
    return { success: true, pushed: result.pushed, pulled: result.pulled };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Sync failed" };
  }
}
```

## Part 6: Vercel Deployment

### Dashboard config

Update `packages/dashboard/next.config.mjs`:

```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: process.env.TURSO_DATABASE_URL ? undefined : "standalone",
  outputFileTracingRoot: import.meta.dirname,

  // Clerk requires these env vars at build time
  env: {
    NEXT_PUBLIC_CLERK_SIGN_IN_URL: "/sign-in",
    NEXT_PUBLIC_CLERK_SIGN_UP_URL: "/sign-up",
    NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL: "/",
    NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL: "/",
  },

  // Exclude better-sqlite3 from the bundle in hosted mode
  // (Turso client is used instead)
  ...(process.env.TURSO_DATABASE_URL && {
    webpack: (config) => {
      config.externals = [...(config.externals || []), "better-sqlite3", "sqlite-vec"];
      return config;
    },
  }),
};

export default nextConfig;
```

### Vercel project setup

Create `packages/dashboard/vercel.json`:

```json
{
  "buildCommand": "cd ../.. && pnpm build --filter=@engrams/dashboard",
  "outputDirectory": ".next",
  "framework": "nextjs",
  "regions": ["sfo1"]
}
```

### Deploy command

After everything builds:

```bash
cd packages/dashboard && vercel --prod
```

Set the environment variables in Vercel's dashboard or via CLI:
```bash
vercel env add NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
vercel env add CLERK_SECRET_KEY
vercel env add TURSO_DATABASE_URL
vercel env add TURSO_AUTH_TOKEN
vercel env add ENGRAMS_ENCRYPTION_KEY
```

## Part 7: Auto-Sync in MCP Server

Add optional background sync to the MCP server so memories sync automatically without the user triggering it manually.

In `packages/mcp-server/src/server.ts`, after server startup:

```typescript
// Optional auto-sync (if configured)
const creds = loadCredentials();
if (creds?.tursoUrl && creds?.tursoAuthToken) {
  const SYNC_INTERVAL = 5 * 60 * 1000; // 5 minutes

  // Cache the passphrase-derived keys in memory for the session
  // The passphrase is provided on first memory_sync call
  let cachedKeys: EncryptionKeys | null = null;

  setInterval(async () => {
    if (!cachedKeys) return; // Can't sync until passphrase is provided
    try {
      await sync(sqlite, {
        tursoUrl: creds.tursoUrl!,
        tursoAuthToken: creds.tursoAuthToken!,
        keys: cachedKeys,
      }, creds.deviceId);
    } catch {
      // Silent failure — sync is best-effort
    }
  }, SYNC_INTERVAL);
}
```

## Local Schema Additions

Add `@libsql/client` as an optional dependency (not required for local-only users):

```bash
cd packages/core && pnpm add @libsql/client
cd packages/dashboard && pnpm add @libsql/client @clerk/nextjs
```

## File Changes Summary

| File | Changes |
|------|---------|
| `packages/core/src/crypto.ts` | **New**: AES-256-GCM encrypt/decrypt, scrypt KDF, memory encrypt/decrypt |
| `packages/core/src/credentials.ts` | **New**: Load/save/init credentials.json |
| `packages/core/src/sync.ts` | **New**: Turso sync engine (push, pull, init schema) |
| `packages/core/src/db.ts` | Migration: add `updated_at` to memories + connections |
| `packages/core/src/index.ts` | Export crypto, credentials, sync |
| `packages/core/src/__tests__/crypto.test.ts` | **New**: Encryption roundtrip tests |
| `packages/core/package.json` | Add `@libsql/client` |
| `packages/mcp-server/src/server.ts` | Add `memory_sync` tool, auto-sync interval, set `updated_at` on all writes |
| `packages/mcp-server/package.json` | Add `@libsql/client` |
| `packages/dashboard/package.json` | Add `@clerk/nextjs`, `@libsql/client` |
| `packages/dashboard/src/middleware.ts` | **New**: Clerk auth (conditional on hosted mode) |
| `packages/dashboard/src/app/layout.tsx` | ClerkProvider wrapper (conditional) |
| `packages/dashboard/src/app/sign-in/[[...sign-in]]/page.tsx` | **New**: Clerk sign-in |
| `packages/dashboard/src/app/sign-up/[[...sign-up]]/page.tsx` | **New**: Clerk sign-up |
| `packages/dashboard/src/components/nav.tsx` | UserButton (conditional) |
| `packages/dashboard/src/lib/db.ts` | `isHosted` branching for Turso reads |
| `packages/dashboard/src/lib/db-hosted.ts` | **New**: Turso data access + decryption |
| `packages/dashboard/src/app/settings/page.tsx` | Encryption + sync + account settings UI |
| `packages/dashboard/src/app/settings/actions.ts` | **New**: setupPassphrase, saveTursoConfig, triggerSync |
| `packages/dashboard/next.config.mjs` | Clerk env, conditional webpack externals |
| `packages/dashboard/vercel.json` | **New**: Vercel deployment config |

## Important Notes

- **Local users are unaffected.** All Pro tier features are gated behind credentials.json and env vars. If they're not set, everything works exactly as before.
- **Encryption is NOT zero-knowledge in hosted mode.** The hosted dashboard holds a server-side key to decrypt memories for display. True zero-knowledge (client-side decryption) requires a browser crypto layer — defer to a future iteration. The local MCP sync IS zero-knowledge (passphrase never leaves the device).
- **Last-write-wins for conflicts.** The sync engine uses `updated_at` timestamps. If two devices modify the same memory simultaneously, the later write wins. The `memory_events` table preserves full history for manual conflict resolution if needed.
- **Auto-sync requires passphrase on first call.** The MCP server can't auto-sync until the user provides their passphrase via `memory_sync`. After that, the derived keys are cached in memory for the session.
- **Turso free tier** is sufficient for initial Pro users: 500 databases, 9GB storage, 25M row reads/month.

## Verification

```bash
pnpm build && pnpm test
```

Then test:
1. **Encryption roundtrip**: tests cover this
2. **Local mode unchanged**: run dashboard without any new env vars, verify everything works
3. **Sync setup**: add Turso credentials to credentials.json, call `memory_sync` via MCP, verify data appears in Turso dashboard
4. **Settings page**: verify passphrase setup form and Turso config form render and work
5. **Hosted mode**: set `TURSO_DATABASE_URL` env var, verify dashboard reads from Turso (you may need a Turso DB with test data)
6. **Auth**: set Clerk env vars, verify sign-in page renders and protects routes

Don't deploy to Vercel yet — just verify the build. Deployment happens after James sets up the Clerk application and Turso database.

Commit and push when complete.
