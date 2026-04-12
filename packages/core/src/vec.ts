import type { Client } from "@libsql/client";

export const EMBEDDING_DIM = 384;

export async function setupVec(client: Client): Promise<boolean> {
  try {
    // Ensure _migrations table exists
    await client.executeMultiple(`CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY)`);

    const migrated = await client.execute({
      sql: `SELECT 1 FROM _migrations WHERE name = 'vec_to_native'`,
      args: [],
    });

    if (migrated.rows.length === 0) {
      // Add embedding column to memories table
      try {
        await client.execute({
          sql: `ALTER TABLE memories ADD COLUMN embedding F32_BLOB(${EMBEDDING_DIM})`,
          args: [],
        });
      } catch {
        // Column may already exist
      }

      // Create vector index
      try {
        await client.execute({
          sql: `CREATE INDEX IF NOT EXISTS memories_vec_idx ON memories (libsql_vector_idx(embedding))`,
          args: [],
        });
      } catch {
        // Index may already exist
      }

      // Migrate data from old memory_embeddings table if it exists
      try {
        const tableCheck = await client.execute({
          sql: `SELECT name FROM sqlite_master WHERE type='table' AND name='memory_embeddings'`,
          args: [],
        });
        if (tableCheck.rows.length > 0) {
          await client.execute({
            sql: `UPDATE memories SET embedding = (
              SELECT e.embedding FROM memory_embeddings e WHERE e.memory_id = memories.id
            ) WHERE id IN (SELECT memory_id FROM memory_embeddings)`,
            args: [],
          });
          await client.execute({ sql: `DROP TABLE memory_embeddings`, args: [] });
        }
      } catch {
        // Migration from old table is best-effort
      }

      await client.execute({
        sql: `INSERT OR IGNORE INTO _migrations (name) VALUES ('vec_to_native')`,
        args: [],
      });
    }

    return true;
  } catch (err) {
    process.stderr.write(
      `[engrams] libsql vector search not available — falling back to FTS5 only: ${err}\n`,
    );
    return false;
  }
}

export async function insertEmbedding(
  client: Client,
  memoryId: string,
  embedding: Float32Array,
): Promise<void> {
  await client.execute({
    sql: `UPDATE memories SET embedding = vector(?) WHERE id = ?`,
    args: [JSON.stringify(Array.from(embedding)), memoryId],
  });
}

export async function deleteEmbedding(client: Client, memoryId: string): Promise<void> {
  await client.execute({
    sql: `UPDATE memories SET embedding = NULL WHERE id = ?`,
    args: [memoryId],
  });
}

export async function searchVec(
  client: Client,
  queryEmbedding: Float32Array,
  limit = 20,
): Promise<{ memory_id: string; distance: number }[]> {
  const result = await client.execute({
    sql: `SELECT m.id as memory_id, vt.distance
          FROM vector_top_k('memories_vec_idx', vector(?), ?) AS vt
          JOIN memories m ON m.rowid = vt.id
          WHERE m.deleted_at IS NULL`,
    args: [JSON.stringify(Array.from(queryEmbedding)), limit],
  });

  return result.rows.map((row) => ({
    memory_id: row.memory_id as string,
    distance: row.distance as number,
  }));
}
