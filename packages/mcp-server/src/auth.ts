import { createClient, type Client } from "@libsql/client";
import { createHash } from "crypto";
import { resolve } from "path";
import { homedir } from "os";

let _client: Client | null = null;

/** Inject an existing libSQL client for token validation. */
export function initAuthClient(client: Client): void {
  _client = client;
}

function getClient(): Client {
  if (!_client) {
    const url = process.env.TURSO_DATABASE_URL;
    if (url) {
      _client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
    } else {
      _client = createClient({
        url: "file:" + resolve(homedir(), ".engrams", "engrams.db"),
      });
    }
  }
  return _client;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function now(): string {
  return new Date().toISOString();
}

export interface TokenValidation {
  userId: string;
  scopes: string[];
}

/**
 * Validate a Bearer token from an MCP request.
 * Returns the userId and scopes if valid, null otherwise.
 * Also updates last_used_at and last_ip.
 */
export async function validateToken(
  token: string,
  ip?: string,
): Promise<TokenValidation | null> {
  const client = getClient();
  const hash = hashToken(token);
  const result = await client.execute({
    sql: `SELECT user_id, scopes, expires_at FROM api_tokens
          WHERE token_hash = ? AND revoked_at IS NULL`,
    args: [hash],
  });
  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  const expiresAt = row.expires_at as string | null;
  if (expiresAt && new Date(expiresAt) < new Date()) {
    return null; // expired
  }

  // Update last used (fire-and-forget)
  client
    .execute({
      sql: `UPDATE api_tokens SET last_used_at = ?, last_ip = ? WHERE token_hash = ?`,
      args: [now(), ip ?? null, hash],
    })
    .catch(() => {}); // non-critical

  return {
    userId: row.user_id as string,
    scopes: (row.scopes as string).split(","),
  };
}
