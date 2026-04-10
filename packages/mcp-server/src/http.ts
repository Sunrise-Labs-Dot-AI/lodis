import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { randomBytes } from "crypto";
import { eq, and, isNull } from "drizzle-orm";
import {
  memories,
  memoryEvents,
  agentPermissions,
  applyConfirm,
  applyCorrect,
  applyMistake,
} from "@engrams/core";
import type { EngramsDatabase, Client } from "@engrams/core";
import { validateToken } from "./auth.js";

function generateId(): string {
  return randomBytes(16).toString("hex");
}

function now(): string {
  return new Date().toISOString();
}

function json(res: ServerResponse, data: unknown, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function parseBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

export function startHttpApi(
  db: EngramsDatabase,
  client: Client,
  port = 3838,
  userId?: string | null,
) {
  const server = createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method === "OPTIONS") {
      res.writeHead(200);
      res.end();
      return;
    }

    const url = req.url ?? "";

    try {
      const isHosted = !!process.env.TURSO_DATABASE_URL;
      let effectiveUserId = userId ?? null;

      if (isHosted && !effectiveUserId) {
        // Extract Bearer token for cloud mode
        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith("Bearer ")) {
          return json(res, { error: "Authorization required" }, 401);
        }
        const result = await validateToken(authHeader.slice(7));
        if (!result) {
          return json(res, { error: "Invalid or expired token" }, 401);
        }
        effectiveUserId = result.userId;
      }
      // POST /api/memory/:id/confirm
      const confirmMatch = url.match(/^\/api\/memory\/([^/]+)\/confirm$/);
      if (confirmMatch && req.method === "POST") {
        const id = confirmMatch[1];
        const existing = await db
          .select()
          .from(memories)
          .where(and(eq(memories.id, id), isNull(memories.deletedAt), effectiveUserId ? eq(memories.userId, effectiveUserId) : undefined))
          .get();
        if (!existing) return json(res, { error: "Not found" }, 404);

        const newConfidence = applyConfirm(existing.confidence);
        const timestamp = now();
        await db.update(memories)
          .set({
            confidence: newConfidence,
            confirmedCount: existing.confirmedCount + 1,
            confirmedAt: timestamp,
          })
          .where(and(eq(memories.id, id), effectiveUserId ? eq(memories.userId, effectiveUserId) : undefined))
          .run();

        await db.insert(memoryEvents)
          .values({
            id: generateId(),
            memoryId: id,
            eventType: "confirmed",
            agentName: "dashboard",
            oldValue: JSON.stringify({ confidence: existing.confidence }),
            newValue: JSON.stringify({ confidence: newConfidence }),
            timestamp,
          })
          .run();

        return json(res, { id, newConfidence });
      }

      // POST /api/memory/:id/correct
      const correctMatch = url.match(/^\/api\/memory\/([^/]+)\/correct$/);
      if (correctMatch && req.method === "POST") {
        const id = correctMatch[1];
        const body = await parseBody(req);
        const content = body.content as string;
        if (!content) return json(res, { error: "content required" }, 400);

        const existing = await db
          .select()
          .from(memories)
          .where(and(eq(memories.id, id), isNull(memories.deletedAt), effectiveUserId ? eq(memories.userId, effectiveUserId) : undefined))
          .get();
        if (!existing) return json(res, { error: "Not found" }, 404);

        const newConfidence = applyCorrect();
        const timestamp = now();
        await db.update(memories)
          .set({
            content,
            confidence: newConfidence,
            correctedCount: existing.correctedCount + 1,
          })
          .where(and(eq(memories.id, id), effectiveUserId ? eq(memories.userId, effectiveUserId) : undefined))
          .run();

        await db.insert(memoryEvents)
          .values({
            id: generateId(),
            memoryId: id,
            eventType: "corrected",
            agentName: "dashboard",
            oldValue: JSON.stringify({ content: existing.content }),
            newValue: JSON.stringify({ content, confidence: newConfidence }),
            timestamp,
          })
          .run();

        return json(res, { id, newConfidence });
      }

      // POST /api/memory/:id/flag
      const flagMatch = url.match(/^\/api\/memory\/([^/]+)\/flag$/);
      if (flagMatch && req.method === "POST") {
        const id = flagMatch[1];
        const existing = await db
          .select()
          .from(memories)
          .where(and(eq(memories.id, id), isNull(memories.deletedAt), effectiveUserId ? eq(memories.userId, effectiveUserId) : undefined))
          .get();
        if (!existing) return json(res, { error: "Not found" }, 404);

        const newConfidence = applyMistake(existing.confidence);
        const timestamp = now();
        await db.update(memories)
          .set({
            confidence: newConfidence,
            mistakeCount: existing.mistakeCount + 1,
          })
          .where(and(eq(memories.id, id), effectiveUserId ? eq(memories.userId, effectiveUserId) : undefined))
          .run();

        await db.insert(memoryEvents)
          .values({
            id: generateId(),
            memoryId: id,
            eventType: "confidence_changed",
            agentName: "dashboard",
            oldValue: JSON.stringify({ confidence: existing.confidence }),
            newValue: JSON.stringify({ confidence: newConfidence, flaggedAsMistake: true }),
            timestamp,
          })
          .run();

        return json(res, { id, newConfidence });
      }

      // POST /api/memory/:id/delete
      const deleteMatch = url.match(/^\/api\/memory\/([^/]+)\/delete$/);
      if (deleteMatch && req.method === "POST") {
        const id = deleteMatch[1];
        const timestamp = now();
        await db.update(memories)
          .set({ deletedAt: timestamp })
          .where(and(eq(memories.id, id), effectiveUserId ? eq(memories.userId, effectiveUserId) : undefined))
          .run();

        await db.insert(memoryEvents)
          .values({
            id: generateId(),
            memoryId: id,
            eventType: "removed",
            agentName: "dashboard",
            newValue: JSON.stringify({ reason: "deleted via dashboard" }),
            timestamp,
          })
          .run();

        return json(res, { id, deleted: true });
      }

      // POST /api/memory/:id/update
      const updateMatch = url.match(/^\/api\/memory\/([^/]+)\/update$/);
      if (updateMatch && req.method === "POST") {
        const id = updateMatch[1];
        const body = await parseBody(req);
        const updates: Record<string, unknown> = {};
        if (body.content) updates.content = body.content;
        if (body.detail) updates.detail = body.detail;
        if (body.domain) updates.domain = body.domain;

        if (Object.keys(updates).length === 0)
          return json(res, { error: "No fields" }, 400);

        await db.update(memories).set(updates).where(and(eq(memories.id, id), effectiveUserId ? eq(memories.userId, effectiveUserId) : undefined)).run();
        return json(res, { id, updated: true });
      }

      // POST /api/permissions
      if (url === "/api/permissions" && req.method === "POST") {
        const body = await parseBody(req);
        const agentId = body.agentId as string;
        const domain = body.domain as string;
        const canRead = body.canRead !== false ? 1 : 0;
        const canWrite = body.canWrite !== false ? 1 : 0;

        const existing = await db
          .select()
          .from(agentPermissions)
          .where(
            and(
              eq(agentPermissions.agentId, agentId),
              eq(agentPermissions.domain, domain),
              effectiveUserId ? eq(agentPermissions.userId, effectiveUserId) : undefined,
            ),
          )
          .get();

        if (existing) {
          await db.update(agentPermissions)
            .set({ canRead, canWrite })
            .where(
              and(
                eq(agentPermissions.agentId, agentId),
                eq(agentPermissions.domain, domain),
                effectiveUserId ? eq(agentPermissions.userId, effectiveUserId) : undefined,
              ),
            )
            .run();
        } else {
          await db.insert(agentPermissions)
            .values({ agentId, domain, canRead, canWrite, userId: effectiveUserId ?? null })
            .run();
        }

        return json(res, { agentId, domain, canRead: !!canRead, canWrite: !!canWrite });
      }

      // DELETE /api/permissions
      if (url === "/api/permissions" && req.method === "DELETE") {
        const body = await parseBody(req);
        const agentId = body.agentId as string;
        const domain = body.domain as string;
        if (!agentId || !domain) return json(res, { error: "agentId and domain required" }, 400);

        await db.delete(agentPermissions)
          .where(
            and(
              eq(agentPermissions.agentId, agentId),
              eq(agentPermissions.domain, domain),
              effectiveUserId ? eq(agentPermissions.userId, effectiveUserId) : undefined,
            ),
          )
          .run();

        return json(res, { agentId, domain, deleted: true });
      }

      // POST /api/clear-all
      if (url === "/api/clear-all" && req.method === "POST") {
        const timestamp = now();
        if (effectiveUserId) {
          await client.execute({
            sql: `UPDATE memories SET deleted_at = ? WHERE deleted_at IS NULL AND user_id = ?`,
            args: [timestamp, effectiveUserId],
          });
        } else {
          await client.execute({
            sql: `UPDATE memories SET deleted_at = ? WHERE deleted_at IS NULL`,
            args: [timestamp],
          });
        }
        return json(res, { cleared: true });
      }

      json(res, { error: "Not found" }, 404);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown error";
      json(res, { error: message }, 500);
    }
  });

  server.listen(port, () => {
    // HTTP API listening silently
  });

  return server;
}
