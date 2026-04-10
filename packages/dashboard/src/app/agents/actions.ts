"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@libsql/client";
import { resolve } from "path";
import { homedir } from "os";
import { getUserId } from "@/lib/auth";

function getClient() {
  if (process.env.TURSO_DATABASE_URL) {
    return createClient({
      url: process.env.TURSO_DATABASE_URL,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
  }
  return createClient({
    url: "file:" + resolve(homedir(), ".engrams", "engrams.db"),
  });
}

function userFilter(userId: string | null): { clause: string; args: (string | null)[] } {
  if (!userId) return { clause: "", args: [] };
  return { clause: " AND user_id = ?", args: [userId] };
}

export async function upsertPermission(
  agentId: string,
  domain: string,
  canRead: boolean,
  canWrite: boolean,
) {
  const client = getClient();
  const userId = await getUserId();
  const uf = userFilter(userId);

  const existing = await client.execute({
    sql: `SELECT 1 FROM agent_permissions WHERE agent_id = ? AND domain = ?${uf.clause}`,
    args: [agentId, domain, ...uf.args],
  });

  if (existing.rows.length > 0) {
    await client.execute({
      sql: `UPDATE agent_permissions SET can_read = ?, can_write = ? WHERE agent_id = ? AND domain = ?${uf.clause}`,
      args: [canRead ? 1 : 0, canWrite ? 1 : 0, agentId, domain, ...uf.args],
    });
  } else {
    await client.execute({
      sql: `INSERT INTO agent_permissions (agent_id, domain, can_read, can_write, user_id) VALUES (?, ?, ?, ?, ?)`,
      args: [agentId, domain, canRead ? 1 : 0, canWrite ? 1 : 0, userId],
    });
  }

  revalidatePath("/agents");
}

export async function removePermission(agentId: string, domain: string) {
  const client = getClient();
  const userId = await getUserId();
  const uf = userFilter(userId);

  await client.execute({
    sql: `DELETE FROM agent_permissions WHERE agent_id = ? AND domain = ?${uf.clause}`,
    args: [agentId, domain, ...uf.args],
  });

  revalidatePath("/agents");
}

export async function togglePermission(
  agentId: string,
  domain: string,
  field: "read" | "write",
  currentValue: boolean,
) {
  const client = getClient();
  const userId = await getUserId();
  const uf = userFilter(userId);

  const col = field === "read" ? "can_read" : "can_write";
  await client.execute({
    sql: `UPDATE agent_permissions SET ${col} = ? WHERE agent_id = ? AND domain = ?${uf.clause}`,
    args: [currentValue ? 0 : 1, agentId, domain, ...uf.args],
  });

  revalidatePath("/agents");
}
