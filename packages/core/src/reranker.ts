import { resolve } from "path";
import { homedir } from "os";

export const DEFAULT_RERANKER_MODEL = "Xenova/bge-reranker-base";

export interface RerankCandidate {
  id: string;
  text: string;
}

export interface RerankResult {
  id: string;
  score: number;
  rank: number;
}

// Using any for the HF pipeline objects — @huggingface/transformers has extremely
// complex union types that blow up TS2590 if referenced directly, same pattern
// used in embeddings.ts for feature-extraction pipeline.
interface LoadedReranker {
  tokenizer: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  model: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  modelId: string;
}

let loaded: LoadedReranker | null = null;
let loadPromise: Promise<LoadedReranker> | null = null;

async function loadReranker(modelId: string): Promise<LoadedReranker> {
  const { AutoTokenizer, AutoModelForSequenceClassification } = await import("@huggingface/transformers");
  const cacheDir = resolve(homedir(), ".lodis", "models");
  const [tokenizer, model] = await Promise.all([
    (AutoTokenizer as any).from_pretrained(modelId, { cache_dir: cacheDir }),
    (AutoModelForSequenceClassification as any).from_pretrained(modelId, {
      cache_dir: cacheDir,
      dtype: "q8",
    }),
  ]);
  return { tokenizer, model, modelId };
}

export async function getReranker(modelId = DEFAULT_RERANKER_MODEL): Promise<LoadedReranker> {
  if (loaded && loaded.modelId === modelId) return loaded;
  if (loadPromise) {
    const p = await loadPromise;
    if (p.modelId === modelId) return p;
  }
  loadPromise = loadReranker(modelId);
  loaded = await loadPromise;
  return loaded;
}

/**
 * Rerank candidates by query relevance using a cross-encoder.
 *
 * Returns results sorted by descending score, with `rank` (1-indexed) assigned
 * post-sort. If `topK` is provided, returns only the top K candidates.
 *
 * Empty candidates → returns [] without loading the model.
 *
 * BGE-reranker outputs a single logit per pair; higher = more relevant.
 */
export async function rerank(
  query: string,
  candidates: RerankCandidate[],
  options: { topK?: number; modelId?: string; batchSize?: number } = {},
): Promise<RerankResult[]> {
  if (candidates.length === 0) return [];

  const { tokenizer, model } = await getReranker(options.modelId);
  const batchSize = options.batchSize ?? 32;

  const rawScores: number[] = new Array(candidates.length);
  for (let i = 0; i < candidates.length; i += batchSize) {
    const chunk = candidates.slice(i, i + batchSize);
    const queries = new Array(chunk.length).fill(query);
    const docs = chunk.map((c) => c.text);
    const inputs = tokenizer(queries, {
      text_pair: docs,
      padding: true,
      truncation: true,
      return_tensors: "pt",
    });
    const outputs = await model(inputs);
    // BGE-reranker-base has num_labels=1. logits shape: [batch_size, 1].
    const logits = outputs.logits.data as Float32Array;
    for (let j = 0; j < chunk.length; j++) {
      rawScores[i + j] = logits[j];
    }
  }

  const scored = candidates.map((c, i) => ({
    id: c.id,
    score: rawScores[i],
    rank: 0,
  }));
  scored.sort((a, b) => b.score - a.score);
  for (let i = 0; i < scored.length; i++) scored[i].rank = i + 1;

  const topK = options.topK ?? scored.length;
  return scored.slice(0, topK);
}
