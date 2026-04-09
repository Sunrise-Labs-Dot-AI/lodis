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
import type { EngramsDatabase } from "@engrams/core";
import type Database from "better-sqlite3";

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
  sqlite: Database.Database,
  port = 3838,
) {
  const server = createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(200);
      res.end();
      return;
    }

    const url = req.url ?? "";

    try {
      // POST /api/memory/:id/confirm
      const confirmMatch = url.match(/^\/api\/memory\/([^/]+)\/confirm$/);
      if (confirmMatch && req.method === "POST") {
        const id = confirmMatch[1];
        const existing = db
          .select()
          .from(memories)
          .where(and(eq(memories.id, id), isNull(memories.deletedAt)))
          .get();
        if (!existing) return json(res, { error: "Not found" }, 404);

        const newConfidence = applyConfirm(existing.confidence);
        const timestamp = now();
        db.update(memories)
          .set({
            confidence: newConfidence,
            confirmedCount: existing.confirmedCount + 1,
            confirmedAt: timestamp,
          })
          .where(eq(memories.id, id))
          .run();

        db.insert(memoryEvents)
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

        const existing = db
          .select()
          .from(memories)
          .where(and(eq(memories.id, id), isNull(memories.deletedAt)))
          .get();
        if (!existing) return json(res, { error: "Not found" }, 404);

        const newConfidence = applyCorrect();
        const timestamp = now();
        db.update(memories)
          .set({
            content,
            confidence: newConfidence,
            correctedCount: existing.correctedCount + 1,
          })
          .where(eq(memories.id, id))
          .run();

        db.insert(memoryEvents)
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
        const existing = db
          .select()
          .from(memories)
          .where(and(eq(memories.id, id), isNull(memories.deletedAt)))
          .get();
        if (!existing) return json(res, { error: "Not found" }, 404);

        const newConfidence = applyMistake(existing.confidence);
        const timestamp = now();
        db.update(memories)
          .set({
            confidence: newConfidence,
            mistakeCount: existing.mistakeCount + 1,
          })
          .where(eq(memories.id, id))
          .run();

        db.insert(memoryEvents)
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
        db.update(memories)
          .set({ deletedAt: timestamp })
          .where(eq(memories.id, id))
          .run();

        db.insert(memoryEvents)
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

        db.update(memories).set(updates).where(eq(memories.id, id)).run();
        return json(res, { id, updated: true });
      }

      // POST /api/permissions
      if (url === "/api/permissions" && req.method === "POST") {
        const body = await parseBody(req);
        const agentId = body.agentId as string;
        const domain = body.domain as string;
        const canRead = body.canRead !== false ? 1 : 0;
        const canWrite = body.canWrite !== false ? 1 : 0;

        const existing = db
          .select()
          .from(agentPermissions)
          .where(
            and(
              eq(agentPermissions.agentId, agentId),
              eq(agentPermissions.domain, domain),
            ),
          )
          .get();

        if (existing) {
          db.update(agentPermissions)
            .set({ canRead, canWrite })
            .where(
              and(
                eq(agentPermissions.agentId, agentId),
                eq(agentPermissions.domain, domain),
              ),
            )
            .run();
        } else {
          db.insert(agentPermissions)
            .values({ agentId, domain, canRead, canWrite })
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

        db.delete(agentPermissions)
          .where(
            and(
              eq(agentPermissions.agentId, agentId),
              eq(agentPermissions.domain, domain),
            ),
          )
          .run();

        return json(res, { agentId, domain, deleted: true });
      }

      // POST /api/clear-all
      if (url === "/api/clear-all" && req.method === "POST") {
        const timestamp = now();
        sqlite.prepare(`UPDATE memories SET deleted_at = ? WHERE deleted_at IS NULL`).run(timestamp);
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
