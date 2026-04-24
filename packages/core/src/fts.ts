import type { Client } from "@libsql/client";

export async function setupFTS(client: Client): Promise<void> {
  await client.executeMultiple(`
    CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
      content,
      detail,
      source_agent_name,
      entity_name,
      content='memories',
      content_rowid='rowid',
      tokenize='porter unicode61'
    );
  `);

  await client.executeMultiple(`
    CREATE TRIGGER IF NOT EXISTS memory_fts_insert AFTER INSERT ON memories BEGIN
      INSERT INTO memory_fts(rowid, content, detail, source_agent_name, entity_name)
      VALUES (new.rowid, new.content, new.detail, new.source_agent_name, new.entity_name);
    END;
  `);

  await client.executeMultiple(`
    CREATE TRIGGER IF NOT EXISTS memory_fts_delete AFTER DELETE ON memories BEGIN
      INSERT INTO memory_fts(memory_fts, rowid, content, detail, source_agent_name, entity_name)
      VALUES ('delete', old.rowid, old.content, old.detail, old.source_agent_name, old.entity_name);
    END;
  `);

  await client.executeMultiple(`
    CREATE TRIGGER IF NOT EXISTS memory_fts_update AFTER UPDATE ON memories BEGIN
      INSERT INTO memory_fts(memory_fts, rowid, content, detail, source_agent_name, entity_name)
      VALUES ('delete', old.rowid, old.content, old.detail, old.source_agent_name, old.entity_name);
      INSERT INTO memory_fts(rowid, content, detail, source_agent_name, entity_name)
      VALUES (new.rowid, new.content, new.detail, new.source_agent_name, new.entity_name);
    END;
  `);
}

/**
 * Preprocess a search query for FTS5.
 * - Splits on whitespace into tokens
 * - Wraps each token in double quotes to escape FTS5 operators
 * - Escapes embedded double-quotes (SQLite FTS5 convention: "" inside a
 *   phrase is a literal quote) — without this, a user query containing
 *   `say "hello"` produces `"say" OR ""hello""` which breaks FTS5's
 *   phrase parser and silently collapses the MATCH (Security-3 on PR #84,
 *   adversarial agents could selectively degrade retrieval by crafting
 *   quote-containing queries that throw inside searchFTS's try/catch).
 * - Joins with OR so any matching token contributes results
 */
function preprocessFTSQuery(query: string): string {
  const tokens = query
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return query;
  // Quote each token to prevent FTS5 syntax errors from special chars;
  // escape embedded " by doubling per SQLite FTS5 convention.
  return tokens.map((t) => `"${t.replace(/"/g, '""')}"`).join(" OR ");
}

export async function searchFTS(
  client: Client,
  query: string,
  limit = 20,
): Promise<{ rowid: number }[]> {
  const ftsQuery = preprocessFTSQuery(query);
  const result = await client.execute({
    sql: `SELECT rowid FROM memory_fts WHERE memory_fts MATCH ? ORDER BY rank LIMIT ?`,
    args: [ftsQuery, limit],
  });
  return result.rows.map((row) => ({ rowid: row.rowid as number }));
}
