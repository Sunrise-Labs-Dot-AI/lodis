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

export interface RerankOptions {
  topK?: number;
  batchSize?: number;
  signal?: AbortSignal;
}

/**
 * Common contract for any backend that can score (query, candidate) pairs
 * and return a reranked subset. Two implementations ship in-tree:
 *   • LocalReranker — in-process BGE-reranker-base via @huggingface/transformers.
 *     Fast per-call once warm, but ~13-15s cold-start per Node process.
 *   • HttpReranker — HTTP POST to a remote warm service (e.g. Modal, Fly).
 *     ~100ms p50 round-trip latency, no cold-start on the MCP side.
 *
 * Consumer-facing consumers should use the selectRerankerProvider() helper
 * which picks the right implementation based on env-var config.
 */
export interface RerankerProvider {
  rerank(
    query: string,
    candidates: RerankCandidate[],
    options?: RerankOptions,
  ): Promise<RerankResult[]>;
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
 * Local in-process reranker. Loads BGE-reranker-base via Transformers.js
 * and runs ONNX inference on the current Node process. Incurs a one-time
 * ~13-15s cold-start (model download + ONNX runtime init) on first call
 * in a given process; subsequent calls are ~5ms per 200 pairs on CPU.
 *
 * Not viable for Vercel-style serverless without warming, since each cold
 * Lambda invocation pays the full cold-start. Ship HttpReranker there.
 */
export class LocalReranker implements RerankerProvider {
  constructor(private readonly modelId: string = DEFAULT_RERANKER_MODEL) {}

  async rerank(
    query: string,
    candidates: RerankCandidate[],
    options: RerankOptions = {},
  ): Promise<RerankResult[]> {
    if (candidates.length === 0) return [];

    const { tokenizer, model } = await getReranker(this.modelId);
    const batchSize = options.batchSize ?? 32;

    const rawScores: number[] = new Array(candidates.length);
    for (let i = 0; i < candidates.length; i += batchSize) {
      if (options.signal?.aborted) throw new Error("rerank aborted");
      const chunk = candidates.slice(i, i + batchSize);
      const queries = new Array(chunk.length).fill(query);
      const docs = chunk.map((c) => c.text);
      // Transformers.js v3 tokenizer accepts text_pair for sequence-classification
      // cross-encoder input. Note: `return_tensors: "pt"` is PyTorch-only — some
      // v3 builds reject unknown keys, so we omit it. The tokenizer returns
      // Tensor-wrapped outputs (input_ids / attention_mask) by default.
      const inputs = tokenizer(queries, {
        text_pair: docs,
        padding: true,
        truncation: true,
      });
      const outputs = await model(inputs);
      if (!outputs || !outputs.logits || !outputs.logits.data) {
        const keys = outputs ? Object.keys(outputs).join(",") : "<null>";
        throw new Error(`reranker model output missing .logits.data (got keys: ${keys})`);
      }
      const logits = outputs.logits.data as Float32Array;
      for (let j = 0; j < chunk.length; j++) {
        rawScores[i + j] = logits[j];
      }
    }

    return finalizeScores(candidates, rawScores, options.topK);
  }
}

/**
 * HTTP-backed reranker — POSTs to a remote service that exposes the same
 * (query, candidates) → scored results contract. Suitable for hosted /
 * serverless deploys where cold-start of an in-process model is too slow.
 *
 * Wire protocol (request):
 *   POST <endpoint>
 *   Headers: content-type: application/json; [authorization: Bearer <key>]
 *   Body: { query: string, candidates: [{id, text}], topK?: number }
 *
 * Wire protocol (response):
 *   200 OK
 *   Body: { results: [{id, score, rank}] }  (sorted by descending score)
 *
 * The reference server implementation ships at `modal/rerank_app.py`
 * and is designed to be `modal deploy`-ed with keep_warm=1 for <1s cold-start.
 */
export class HttpReranker implements RerankerProvider {
  constructor(
    private readonly endpoint: string,
    private readonly apiKey?: string,
    private readonly timeoutMs: number = 5000,
  ) {}

  async rerank(
    query: string,
    candidates: RerankCandidate[],
    options: RerankOptions = {},
  ): Promise<RerankResult[]> {
    if (candidates.length === 0) return [];

    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.apiKey) headers["authorization"] = `Bearer ${this.apiKey}`;

    // Compose an AbortSignal: caller's signal + a timeout. Whichever fires
    // first wins. Use the standard AbortSignal.any if available (Node 20+).
    const timeoutSignal = AbortSignal.timeout(this.timeoutMs);
    const signal = options.signal
      ? (AbortSignal as unknown as { any(s: AbortSignal[]): AbortSignal }).any([options.signal, timeoutSignal])
      : timeoutSignal;

    const res = await fetch(this.endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        query,
        candidates,
        ...(options.topK !== undefined ? { topK: options.topK } : {}),
      }),
      signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "<unreadable>");
      throw new Error(`HttpReranker ${res.status}: ${body.slice(0, 300)}`);
    }
    const data = (await res.json()) as { results?: RerankResult[] };
    if (!Array.isArray(data.results)) {
      throw new Error(`HttpReranker: malformed response (missing results array)`);
    }
    // Trust the server's ordering but defensively normalize ranks to 1-indexed
    // post-sort in case a server implementation omits them.
    const out = [...data.results];
    out.sort((a, b) => b.score - a.score);
    for (let i = 0; i < out.length; i++) out[i].rank = i + 1;
    const topK = options.topK ?? out.length;
    return out.slice(0, topK);
  }
}

/**
 * Shared helper: given raw scores parallel to candidates, produce sorted
 * + rank-annotated results trimmed to topK. Used by LocalReranker.
 */
function finalizeScores(
  candidates: RerankCandidate[],
  rawScores: number[],
  topK: number | undefined,
): RerankResult[] {
  const scored: RerankResult[] = candidates.map((c, i) => ({
    id: c.id,
    score: rawScores[i],
    rank: 0,
  }));
  scored.sort((a, b) => b.score - a.score);
  for (let i = 0; i < scored.length; i++) scored[i].rank = i + 1;
  const k = topK ?? scored.length;
  return scored.slice(0, k);
}

/**
 * Pick a RerankerProvider based on env-var config. Evaluated per call so
 * tests can mutate process.env without module reload.
 *
 *   • LODIS_RERANKER_URL set           → HttpReranker(url, apiKey)
 *   • otherwise                        → LocalReranker(default model)
 *
 * Returns null if no provider is selectable (currently never — at least
 * LocalReranker is always available — but keeps the type honest for
 * future "no reranker compiled" builds).
 */
export function selectRerankerProvider(): RerankerProvider | null {
  const url = process.env.LODIS_RERANKER_URL;
  if (url) {
    const apiKey = process.env.LODIS_RERANKER_API_KEY;
    const timeoutMs = process.env.LODIS_RERANKER_TIMEOUT_MS
      ? Number(process.env.LODIS_RERANKER_TIMEOUT_MS)
      : undefined;
    return new HttpReranker(url, apiKey, timeoutMs);
  }
  const modelId = process.env.LODIS_RERANKER_MODEL ?? DEFAULT_RERANKER_MODEL;
  return new LocalReranker(modelId);
}

/**
 * Back-compat free function. Delegates to the env-selected provider so
 * callers that import `rerank` directly keep working. New code should
 * hold a RerankerProvider reference for testability.
 */
export async function rerank(
  query: string,
  candidates: RerankCandidate[],
  options: { topK?: number; modelId?: string; batchSize?: number } = {},
): Promise<RerankResult[]> {
  // Honor the explicit modelId override by constructing a LocalReranker
  // directly — this matches the pre-abstraction signature used by tests.
  if (options.modelId) {
    return new LocalReranker(options.modelId).rerank(query, candidates, {
      topK: options.topK,
      batchSize: options.batchSize,
    });
  }
  const provider = selectRerankerProvider();
  if (!provider) return [];
  return provider.rerank(query, candidates, { topK: options.topK, batchSize: options.batchSize });
}
