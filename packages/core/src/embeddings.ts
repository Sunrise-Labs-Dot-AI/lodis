import { resolve } from "path";
import { homedir } from "os";
import type Database from "better-sqlite3";
import { insertEmbedding } from "./vec.js";

export const EMBEDDING_DIM = 384;

const MODEL_ID = "Xenova/all-MiniLM-L6-v2";

// Use dynamic import + type assertion to avoid TS2590 (union too complex) from @huggingface/transformers
type Embedder = (text: string, options: { pooling: string; normalize: boolean }) => Promise<{ data: ArrayLike<number> }>;
let embedder: Embedder | null = null;

export async function getEmbedder(): Promise<Embedder> {
  if (!embedder) {
    const { pipeline } = await import("@huggingface/transformers");
    const cacheDir = resolve(homedir(), ".engrams", "models");
    const model = await (pipeline as Function)("feature-extraction", MODEL_ID, {
      cache_dir: cacheDir,
      dtype: "q8",
    });
    embedder = model as Embedder;
  }
  return embedder;
}

// --- LRU Embedding Cache ---
const CACHE_MAX = 100;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface CacheEntry {
  embedding: Float32Array;
  timestamp: number;
}

const embeddingCache = new Map<string, CacheEntry>();

export async function generateEmbedding(text: string): Promise<Float32Array> {
  // Check cache
  const cached = embeddingCache.get(text);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.embedding;
  }

  const model = await getEmbedder();
  const output = await model(text, { pooling: "mean", normalize: true });
  const embedding = new Float32Array(output.data as Float64Array);

  // Store in cache, evict oldest if full
  if (embeddingCache.size >= CACHE_MAX) {
    const oldestKey = embeddingCache.keys().next().value;
    if (oldestKey) embeddingCache.delete(oldestKey);
  }
  embeddingCache.set(text, { embedding, timestamp: Date.now() });

  return embedding;
}

export async function generateEmbeddings(texts: string[]): Promise<Float32Array[]> {
  const model = await getEmbedder();
  const results: Float32Array[] = [];
  for (let i = 0; i < texts.length; i += 32) {
    const batch = texts.slice(i, i + 32);
    for (const text of batch) {
      const output = await model(text, { pooling: "mean", normalize: true });
      results.push(new Float32Array(output.data as Float64Array));
    }
  }
  return results;
}

export async function backfillEmbeddings(sqlite: Database.Database): Promise<number> {
  const missing = sqlite
    .prepare(`
      SELECT m.id, m.content, m.detail FROM memories m
      LEFT JOIN memory_embeddings e ON m.id = e.memory_id
      WHERE m.deleted_at IS NULL AND e.memory_id IS NULL
    `)
    .all() as { id: string; content: string; detail: string | null }[];

  let count = 0;
  for (const mem of missing) {
    try {
      const text = mem.content + (mem.detail ? " " + mem.detail : "");
      const embedding = await generateEmbedding(text);
      insertEmbedding(sqlite, mem.id, embedding);
      count++;
    } catch {
      // Per-memory failure is non-fatal — continue backfilling
    }
  }

  return count;
}
