import { createClient, type Client } from "@libsql/client";
import { createHash, randomBytes } from "crypto";

// --- Client singleton (reuses the same Turso connection as db.ts) ---

let _client: Client | null = null;

function getClient(): Client {
  if (!_client) {
    const url = process.env.TURSO_DATABASE_URL;
    const authToken = process.env.TURSO_AUTH_TOKEN;
    if (!url) throw new Error("TURSO_DATABASE_URL is required for OAuth");
    _client = createClient({ url, authToken });
  }
  return _client;
}

// --- Schema init ---

let _schemaReady: Promise<void> | null = null;

export function ensureOAuthSchema(): Promise<void> {
  if (!_schemaReady) {
    _schemaReady = initSchema();
  }
  return _schemaReady;
}

async function initSchema(): Promise<void> {
  const client = getClient();
  await client.execute(`
    CREATE TABLE IF NOT EXISTS oauth_clients (
      client_id TEXT PRIMARY KEY,
      client_secret_hash TEXT,
      redirect_uris TEXT NOT NULL,
      client_name TEXT,
      created_at TEXT NOT NULL
    )
  `);
  await client.execute(`
    CREATE TABLE IF NOT EXISTS oauth_codes (
      code TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      redirect_uri TEXT NOT NULL,
      code_challenge TEXT NOT NULL,
      code_challenge_method TEXT NOT NULL DEFAULT 'S256',
      scopes TEXT NOT NULL DEFAULT 'mcp:full',
      expires_at TEXT NOT NULL,
      used INTEGER NOT NULL DEFAULT 0
    )
  `);
  await client.execute(`
    CREATE TABLE IF NOT EXISTS oauth_tokens (
      token_hash TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      scopes TEXT NOT NULL,
      refresh_token_hash TEXT,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      revoked_at TEXT
    )
  `);
}

// --- Helpers ---

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function randomHex(bytes = 32): string {
  return randomBytes(bytes).toString("hex");
}

function now(): string {
  return new Date().toISOString();
}

function addSeconds(seconds: number): string {
  return new Date(Date.now() + seconds * 1000).toISOString();
}

// --- Dynamic Client Registration (RFC 7591) ---

export interface RegisteredClient {
  clientId: string;
  clientSecret: string | null;
  redirectUris: string[];
  clientName: string | null;
}

export async function registerClient(
  redirectUris: string[],
  clientName?: string,
  requireSecret = false,
): Promise<RegisteredClient> {
  await ensureOAuthSchema();
  const client = getClient();

  const clientId = randomHex(16);
  const clientSecret = requireSecret ? randomHex(32) : null;

  await client.execute({
    sql: `INSERT INTO oauth_clients (client_id, client_secret_hash, redirect_uris, client_name, created_at)
          VALUES (?, ?, ?, ?, ?)`,
    args: [
      clientId,
      clientSecret ? hash(clientSecret) : null,
      JSON.stringify(redirectUris),
      clientName ?? null,
      now(),
    ],
  });

  return { clientId, clientSecret, redirectUris, clientName: clientName ?? null };
}

export async function getRegisteredClient(clientId: string): Promise<{
  clientId: string;
  clientSecretHash: string | null;
  redirectUris: string[];
  clientName: string | null;
} | null> {
  await ensureOAuthSchema();
  const client = getClient();
  const result = await client.execute({
    sql: `SELECT * FROM oauth_clients WHERE client_id = ?`,
    args: [clientId],
  });
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  return {
    clientId: row.client_id as string,
    clientSecretHash: row.client_secret_hash as string | null,
    redirectUris: JSON.parse(row.redirect_uris as string),
    clientName: row.client_name as string | null,
  };
}

// --- Authorization Codes ---

export async function createAuthCode(opts: {
  clientId: string;
  userId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  scopes: string;
}): Promise<string> {
  await ensureOAuthSchema();
  const client = getClient();
  const code = randomHex(32);

  await client.execute({
    sql: `INSERT INTO oauth_codes (code, client_id, user_id, redirect_uri, code_challenge, code_challenge_method, scopes, expires_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      code,
      opts.clientId,
      opts.userId,
      opts.redirectUri,
      opts.codeChallenge,
      opts.codeChallengeMethod,
      opts.scopes,
      addSeconds(600), // 10 minutes
    ],
  });

  return code;
}

export async function exchangeAuthCode(code: string, codeVerifier: string, clientId: string, redirectUri: string): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  userId: string;
  scopes: string;
} | null> {
  await ensureOAuthSchema();
  const client = getClient();

  const result = await client.execute({
    sql: `SELECT * FROM oauth_codes WHERE code = ? AND used = 0`,
    args: [code],
  });
  if (result.rows.length === 0) return null;
  const row = result.rows[0];

  // Mark as used immediately (single-use)
  await client.execute({
    sql: `UPDATE oauth_codes SET used = 1 WHERE code = ?`,
    args: [code],
  });

  // Check expiry
  if (new Date(row.expires_at as string) < new Date()) return null;

  // Verify client_id and redirect_uri match
  if (row.client_id !== clientId) return null;
  if (row.redirect_uri !== redirectUri) return null;

  // Verify PKCE
  const method = row.code_challenge_method as string;
  const expectedChallenge = row.code_challenge as string;
  if (method === "S256") {
    const computed = createHash("sha256")
      .update(codeVerifier)
      .digest("base64url");
    if (computed !== expectedChallenge) return null;
  } else {
    // plain method (not recommended but in spec)
    if (codeVerifier !== expectedChallenge) return null;
  }

  // Issue tokens
  const userId = row.user_id as string;
  const scopes = row.scopes as string;
  const expiresIn = 3600; // 1 hour

  const accessToken = `engrams_at_${randomHex(32)}`;
  const refreshToken = `engrams_rt_${randomHex(32)}`;

  await client.execute({
    sql: `INSERT INTO oauth_tokens (token_hash, client_id, user_id, scopes, refresh_token_hash, expires_at, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [
      hash(accessToken),
      clientId,
      userId,
      scopes,
      hash(refreshToken),
      addSeconds(expiresIn),
      now(),
    ],
  });

  return { accessToken, refreshToken, expiresIn, userId, scopes };
}

// --- Refresh Tokens ---

export async function refreshAccessToken(refreshToken: string, clientId: string): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
} | null> {
  await ensureOAuthSchema();
  const client = getClient();
  const refreshHash = hash(refreshToken);

  // Find existing token by refresh_token_hash
  const result = await client.execute({
    sql: `SELECT * FROM oauth_tokens WHERE refresh_token_hash = ? AND client_id = ? AND revoked_at IS NULL`,
    args: [refreshHash, clientId],
  });
  if (result.rows.length === 0) return null;
  const row = result.rows[0];

  // Revoke old token
  await client.execute({
    sql: `UPDATE oauth_tokens SET revoked_at = ? WHERE token_hash = ?`,
    args: [now(), row.token_hash as string],
  });

  // Issue new tokens
  const expiresIn = 3600;
  const newAccessToken = `engrams_at_${randomHex(32)}`;
  const newRefreshToken = `engrams_rt_${randomHex(32)}`;

  await client.execute({
    sql: `INSERT INTO oauth_tokens (token_hash, client_id, user_id, scopes, refresh_token_hash, expires_at, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [
      hash(newAccessToken),
      clientId,
      row.user_id as string,
      row.scopes as string,
      hash(newRefreshToken),
      addSeconds(expiresIn),
      now(),
    ],
  });

  return { accessToken: newAccessToken, refreshToken: newRefreshToken, expiresIn };
}

// --- Token Validation ---

export interface OAuthTokenValidation {
  userId: string;
  scopes: string[];
  clientId: string;
}

export async function validateAccessToken(token: string): Promise<OAuthTokenValidation | null> {
  await ensureOAuthSchema();
  const client = getClient();
  const tokenHash = hash(token);

  const result = await client.execute({
    sql: `SELECT user_id, scopes, client_id, expires_at FROM oauth_tokens
          WHERE token_hash = ? AND revoked_at IS NULL`,
    args: [tokenHash],
  });
  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  if (new Date(row.expires_at as string) < new Date()) return null;

  return {
    userId: row.user_id as string,
    scopes: (row.scopes as string).split(","),
    clientId: row.client_id as string,
  };
}
