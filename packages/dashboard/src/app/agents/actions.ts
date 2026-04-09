"use server";

import { revalidatePath } from "next/cache";
import { getWriteDb } from "@/lib/db";

export async function upsertPermission(
  agentId: string,
  domain: string,
  canRead: boolean,
  canWrite: boolean,
) {
  const db = getWriteDb();
  const existing = db
    .prepare(
      `SELECT 1 FROM agent_permissions WHERE agent_id = ? AND domain = ?`,
    )
    .get(agentId, domain);

  if (existing) {
    db.prepare(
      `UPDATE agent_permissions SET can_read = ?, can_write = ? WHERE agent_id = ? AND domain = ?`,
    ).run(canRead ? 1 : 0, canWrite ? 1 : 0, agentId, domain);
  } else {
    db.prepare(
      `INSERT INTO agent_permissions (agent_id, domain, can_read, can_write) VALUES (?, ?, ?, ?)`,
    ).run(agentId, domain, canRead ? 1 : 0, canWrite ? 1 : 0);
  }

  revalidatePath("/agents");
}

export async function removePermission(agentId: string, domain: string) {
  const db = getWriteDb();
  db.prepare(
    `DELETE FROM agent_permissions WHERE agent_id = ? AND domain = ?`,
  ).run(agentId, domain);

  revalidatePath("/agents");
}

export async function togglePermission(
  agentId: string,
  domain: string,
  field: "read" | "write",
  currentValue: boolean,
) {
  const db = getWriteDb();
  const col = field === "read" ? "can_read" : "can_write";
  db.prepare(
    `UPDATE agent_permissions SET ${col} = ? WHERE agent_id = ? AND domain = ?`,
  ).run(currentValue ? 0 : 1, agentId, domain);

  revalidatePath("/agents");
}
