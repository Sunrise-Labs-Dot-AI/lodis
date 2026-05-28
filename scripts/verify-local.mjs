// Quick read-only integrity check of the local ~/.lodis/lodis.db after import.
import { createClient } from "@libsql/client";
import os from "node:os";
import path from "node:path";

const c = createClient({ url: "file:" + path.join(os.homedir(), ".lodis", "lodis.db") });
const one = async (sql, args = []) => (await c.execute({ sql, args })).rows[0];

const tables = (await c.execute("SELECT name FROM sqlite_master WHERE type IN ('table','view') ORDER BY name")).rows.map(r => r.name);
console.log("tables:", tables.join(", "));
console.log("memories(non-deleted):", (await one("SELECT COUNT(*) n FROM memories WHERE deleted_at IS NULL")).n);
console.log("embedding column NOT NULL:", (await one("SELECT COUNT(*) n FROM memories WHERE embedding IS NOT NULL")).n);
console.log("connections:", (await one("SELECT COUNT(*) n FROM memory_connections")).n);
console.log("events:", (await one("SELECT COUNT(*) n FROM memory_events")).n);
console.log("visible in local mode (user_id NULL/empty):", (await one("SELECT COUNT(*) n FROM memories WHERE user_id IS NULL OR user_id = ''")).n);
try { console.log("memory_embeddings vec rows:", (await one("SELECT COUNT(*) n FROM memory_embeddings")).n); } catch (e) { console.log("memory_embeddings:", e.message.slice(0, 70)); }
try { console.log("memory_fts rows:", (await one("SELECT COUNT(*) n FROM memory_fts")).n); } catch (e) { console.log("memory_fts:", e.message.slice(0, 70)); }
try {
  const s = await c.execute({ sql: "SELECT m.entity_name, m.domain FROM memory_fts f JOIN memories m ON m.rowid = f.rowid WHERE memory_fts MATCH ? LIMIT 3", args: ["reranker"] });
  console.log("FTS sample ('reranker'):", JSON.stringify(s.rows));
} catch (e) { console.log("FTS query note:", e.message.slice(0, 90)); }
process.exit(0);
