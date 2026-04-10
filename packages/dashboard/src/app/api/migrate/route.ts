import { validateAccessToken } from "@/lib/oauth";
import { createClient } from "@libsql/client";
import { createHash } from "crypto";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface MigrateBody {
  memories: Record<string, unknown>[];
  connections?: Record<string, unknown>[];
  events?: Record<string, unknown>[];
  permissions?: Record<string, unknown>[];
}

/** Validate Bearer token — try OAuth first, fall back to PAT. */
async function authenticateRequest(req: Request): Promise<string | null> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7);

  // Try OAuth token
  const oauthResult = await validateAccessToken(token);
  if (oauthResult) return oauthResult.userId;

  // Fall back to PAT (SHA-256 hash lookup on api_tokens table)
  try {
    const client = getClient();
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const result = await client.execute({
      sql: `SELECT user_id FROM api_tokens WHERE token_hash = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > datetime('now'))`,
      args: [tokenHash],
    });
    if (result.rows.length > 0) {
      // Update last_used_at
      await client.execute({
        sql: `UPDATE api_tokens SET last_used_at = datetime('now') WHERE token_hash = ?`,
        args: [tokenHash],
      });
      return result.rows[0].user_id as string;
    }
  } catch {
    // PAT validation failed — fall through to null
  }

  return null;
}

let _client: ReturnType<typeof createClient> | null = null;
function getClient() {
  if (!_client) {
    const url = process.env.TURSO_DATABASE_URL;
    if (!url) throw new Error("TURSO_DATABASE_URL is required");
    _client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
  }
  return _client;
}

const MEMORY_COLUMNS = [
  "id", "content", "detail", "domain",
  "source_agent_id", "source_agent_name", "cross_agent_id", "cross_agent_name",
  "source_type", "source_description",
  "confidence", "confirmed_count", "corrected_count", "mistake_count", "used_count",
  "learned_at", "confirmed_at", "last_used_at", "deleted_at",
  "has_pii_flag", "entity_type", "entity_name", "structured_data", "updated_at",
] as const;

const CONNECTION_COLUMNS = ["source_memory_id", "target_memory_id", "relationship", "updated_at"] as const;
const EVENT_COLUMNS = ["id", "memory_id", "event_type", "agent_id", "agent_name", "old_value", "new_value", "timestamp"] as const;
const PERMISSION_COLUMNS = ["agent_id", "domain", "can_read", "can_write"] as const;

function extractValues(row: Record<string, unknown>, columns: readonly string[]): (string | number | null)[] {
  return columns.map(col => {
    const val = row[col];
    if (val === undefined || val === null) return null;
    if (typeof val === "number") return val;
    return String(val);
  });
}

export async function POST(req: Request) {
  const userId = await authenticateRequest(req);
  if (!userId) {
    return new Response(JSON.stringify({ error: "Authorization required" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body: MigrateBody;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!Array.isArray(body.memories)) {
    return new Response(JSON.stringify({ error: "memories array is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const client = getClient();
  let migrated = 0;
  let connectionsMigrated = 0;
  let eventsMigrated = 0;
  let permissionsMigrated = 0;

  // Insert memories — user_id is always forced to the authenticated user
  const memPlaceholders = [...MEMORY_COLUMNS, "user_id"].map(() => "?").join(", ");
  const memColNames = [...MEMORY_COLUMNS, "user_id"].join(", ");

  for (const mem of body.memories) {
    try {
      const values = extractValues(mem, MEMORY_COLUMNS);
      values.push(userId); // user_id — always the authenticated user
      await client.execute({
        sql: `INSERT OR REPLACE INTO memories (${memColNames}) VALUES (${memPlaceholders})`,
        args: values,
      });
      migrated++;
    } catch {
      // Skip individual failures (e.g., missing required fields)
    }
  }

  // Insert connections
  if (Array.isArray(body.connections)) {
    const connPlaceholders = [...CONNECTION_COLUMNS, "user_id"].map(() => "?").join(", ");
    const connColNames = [...CONNECTION_COLUMNS, "user_id"].join(", ");
    for (const conn of body.connections) {
      try {
        const values = extractValues(conn, CONNECTION_COLUMNS);
        values.push(userId);
        await client.execute({
          sql: `INSERT OR REPLACE INTO memory_connections (${connColNames}) VALUES (${connPlaceholders})`,
          args: values,
        });
        connectionsMigrated++;
      } catch {
        // Skip
      }
    }
  }

  // Insert events
  if (Array.isArray(body.events)) {
    const evtPlaceholders = [...EVENT_COLUMNS, "user_id"].map(() => "?").join(", ");
    const evtColNames = [...EVENT_COLUMNS, "user_id"].join(", ");
    for (const evt of body.events) {
      try {
        const values = extractValues(evt, EVENT_COLUMNS);
        values.push(userId);
        await client.execute({
          sql: `INSERT OR REPLACE INTO memory_events (${evtColNames}) VALUES (${evtPlaceholders})`,
          args: values,
        });
        eventsMigrated++;
      } catch {
        // Skip
      }
    }
  }

  // Insert permissions
  if (Array.isArray(body.permissions)) {
    const permPlaceholders = [...PERMISSION_COLUMNS, "user_id"].map(() => "?").join(", ");
    const permColNames = [...PERMISSION_COLUMNS, "user_id"].join(", ");
    for (const perm of body.permissions) {
      try {
        const values = extractValues(perm, PERMISSION_COLUMNS);
        values.push(userId);
        await client.execute({
          sql: `INSERT OR REPLACE INTO agent_permissions (${permColNames}) VALUES (${permPlaceholders})`,
          args: values,
        });
        permissionsMigrated++;
      } catch {
        // Skip
      }
    }
  }

  return new Response(
    JSON.stringify({
      migrated,
      connections_migrated: connectionsMigrated,
      events_migrated: eventsMigrated,
      permissions_migrated: permissionsMigrated,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}
