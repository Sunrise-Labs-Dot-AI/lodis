# Lodis rerank service (Modal)

Reference deployment for the HTTP-backed cross-encoder reranker. Keeps Stage 2 of `memory_context` alive on Vercel-style serverless deploys where in-process `onnxruntime-node` has unacceptable cold-start.

## Deploy

```bash
pip install modal
modal setup                             # one-time auth

# Optional: set an API key so only Lodis can call the endpoint
modal secret create rerank-api-key RERANK_API_KEY=<your-secret>

# Deploy
modal deploy modal/rerank_app.py
```

After deploy Modal prints an endpoint URL, e.g.
```
https://<your-workspace>--lodis-reranker-rerank.modal.run
```

## Wire it into Lodis

On Vercel (dashboard project), set:

| Env var | Value |
|---|---|
| `LODIS_RERANKER_URL` | the Modal endpoint URL (from `modal deploy` output) |
| `LODIS_RERANKER_API_KEY` | the bearer token you set as `RERANK_API_KEY`, if any |
| `LODIS_RERANKER_TIMEOUT_MS` | optional, defaults to `5000` |

When `LODIS_RERANKER_URL` is set, `contextSearch` auto-switches to the `HttpReranker` provider. No code change needed — the env var drives provider selection at call time.

## Smoke test

```bash
# Local smoke test (exercises the class without deploying)
modal run modal/rerank_app.py

# Live endpoint smoke test (after deploy)
curl -X POST https://<your-workspace>--lodis-reranker-rerank.modal.run \
  -H "content-type: application/json" \
  -H "authorization: Bearer <your-secret>" \
  -d '{
    "query": "Who is the recruiter at Anthropic for the PM Consumer role?",
    "candidates": [
      {"id": "relevant", "text": "Laura Small: Recruiter at Anthropic for PM Consumer role."},
      {"id": "irrelevant", "text": "James has five siblings."}
    ],
    "topK": 2
  }'
```

Expected response shape:
```json
{
  "results": [
    {"id": "relevant", "score": 7.84, "rank": 1},
    {"id": "irrelevant", "score": -8.12, "rank": 2}
  ]
}
```

Score magnitudes vary per model — BGE-reranker-base typically separates a clearly relevant doc from a clearly irrelevant one by 5–15 logit points.

## Cost / perf budget

| Dimension | Expected value |
|---|---|
| Cold-start (first request to new container) | ~3–5 s (ONNX init + first forward pass) |
| Warm-start (subsequent requests) | 50–200 ms p50 for a query + 40 candidates |
| Warm idle cost (`min_containers=1`, cpu=2, mem=1GB) | ~$0.10/day |
| Per-request cost at modest traffic | <$0.001/query on CPU |

If traffic is sparse enough that warm-idle cost dominates, remove `min_containers=1` from the decorator in `rerank_app.py` — cold-start comes back but Modal scales to $0.

## Troubleshooting

**`HttpReranker 401`** — check `LODIS_RERANKER_API_KEY` matches the `RERANK_API_KEY` Modal secret exactly. If you didn't set a secret, omit the API key env var (don't set an empty string — the Lambda treats that as a real key and sends it).

**`HttpReranker 400: invalid request body`** — the Lambda is posting something shaped wrong. Capture the body at the server; most likely cause is a schema-drift between Lodis's HttpReranker and `rerank_app.py`'s handler.

**Response has no `results` key** — `HttpReranker` throws "malformed response". Likely a FastAPI exception that bypassed the normal response shape. Check Modal logs via `modal app logs lodis-reranker`.

**Latency p99 > 2s** — rerank candidate count too high. `rerankTopK=40` is the typical packed-candidate count; reranking 200 is the upstream scenario. For 200-pair batches expect ~250–500 ms on 2 CPU. If higher, bump to `cpu=4` in the `@app.cls` decorator.
