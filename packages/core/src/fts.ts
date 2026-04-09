import type Database from "better-sqlite3";

export function setupFTS(sqlite: Database.Database): void {
  sqlite.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
      content,
      detail,
      source_agent_name,
      entity_name,
      content='memories',
      content_rowid='rowid'
    );
  `);

  sqlite.exec(`
    CREATE TRIGGER IF NOT EXISTS memory_fts_insert AFTER INSERT ON memories BEGIN
      INSERT INTO memory_fts(rowid, content, detail, source_agent_name, entity_name)
      VALUES (new.rowid, new.content, new.detail, new.source_agent_name, new.entity_name);
    END;
  `);

  sqlite.exec(`
    CREATE TRIGGER IF NOT EXISTS memory_fts_delete AFTER DELETE ON memories BEGIN
      INSERT INTO memory_fts(memory_fts, rowid, content, detail, source_agent_name, entity_name)
      VALUES ('delete', old.rowid, old.content, old.detail, old.source_agent_name, old.entity_name);
    END;
  `);

  sqlite.exec(`
    CREATE TRIGGER IF NOT EXISTS memory_fts_update AFTER UPDATE ON memories BEGIN
      INSERT INTO memory_fts(memory_fts, rowid, content, detail, source_agent_name, entity_name)
      VALUES ('delete', old.rowid, old.content, old.detail, old.source_agent_name, old.entity_name);
      INSERT INTO memory_fts(rowid, content, detail, source_agent_name, entity_name)
      VALUES (new.rowid, new.content, new.detail, new.source_agent_name, new.entity_name);
    END;
  `);
}

export function searchFTS(
  sqlite: Database.Database,
  query: string,
  limit = 20,
): { rowid: number }[] {
  const rows = sqlite
    .prepare(
      `SELECT rowid FROM memory_fts WHERE memory_fts MATCH ? ORDER BY rank LIMIT ?`,
    )
    .all(query, limit) as { rowid: number }[];
  return rows;
}
