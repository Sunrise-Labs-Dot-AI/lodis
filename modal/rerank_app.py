"""
Reference cross-encoder reranker service for Lodis, deployable on Modal.

Wire contract (matches HttpReranker in packages/core/src/reranker.ts):

  POST /rerank
  Headers:
    content-type: application/json
    [authorization: Bearer <RERANK_API_KEY>]           (optional)
  Body:
    {
      "query": "string",
      "candidates": [{"id": "string", "text": "string"}, ...],
      "topK": 40                                        (optional)
    }

  200 OK:
    {
      "results": [{"id": "string", "score": float, "rank": int}, ...]
    }
    (results are sorted by descending score; rank is 1-indexed)

Deployment:

  pip install modal
  modal setup                         # one-time auth
  modal deploy modal/rerank_app.py    # from the repo root

  # Then set these in Vercel env vars for the dashboard:
  LODIS_RERANKER_URL=https://<workspace>--lodis-reranker-rerank.modal.run
  LODIS_RERANKER_API_KEY=<if you set RERANK_API_KEY as a Modal secret>

Keep-warm:
  keep_warm=1 holds one container ready so the first request does not pay the
  ~5s model-load cost. Modal charges for warm idle time — ~$0.10/day on CPU,
  cheap insurance vs. cold-start UX regressions. Scale to 0 by removing
  keep_warm if traffic is sparse and latency sensitivity is low.

Scaling:
  container_idle_timeout controls how long an idle container stays warm after
  serving. 300s is a reasonable default — covers bursty traffic without
  burning money during quiet periods. allow_concurrent_inputs packs multiple
  requests onto one container when possible.
"""

import os

import modal

RERANK_MODEL_ID = "BAAI/bge-reranker-base"

# --- Image ---
# Lean CPU image: PyTorch CPU wheels + Transformers + FastAPI for the web
# endpoint. No CUDA — BGE-reranker-base is tiny enough that CPU inference
# at batch 32 is ~50ms/pair, fine for MCP retrieval latency budgets.
image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install(
        "transformers==4.46.3",
        "torch==2.5.1",
        "fastapi[standard]==0.115.6",
    )
    # Prefetch the model into the image so cold-starts only pay ONNX init,
    # not a HuggingFace Hub download. Saves ~5-8s on first request of a new
    # container.
    .run_commands(
        f'python -c "from transformers import AutoTokenizer, AutoModelForSequenceClassification; '
        f"AutoTokenizer.from_pretrained('{RERANK_MODEL_ID}'); "
        f"AutoModelForSequenceClassification.from_pretrained('{RERANK_MODEL_ID}')\""
    )
)

app = modal.App("lodis-reranker", image=image)

# Optional bearer-token auth. If RERANK_API_KEY Modal secret is set, the
# endpoint will require `authorization: Bearer <key>` on every request.
# Otherwise the endpoint is open (fine for dev / localhost forwarding).
api_key_secret = modal.Secret.from_name("rerank-api-key", required_keys=[])


@app.cls(
    cpu=2.0,
    memory=1024,
    keep_warm=1,
    container_idle_timeout=300,
    allow_concurrent_inputs=10,
    secrets=[api_key_secret],
)
class Reranker:
    """Loads BGE-reranker-base once per container; reuses for all requests."""

    @modal.enter()
    def load(self):
        import torch
        from transformers import AutoModelForSequenceClassification, AutoTokenizer

        self.tokenizer = AutoTokenizer.from_pretrained(RERANK_MODEL_ID)
        self.model = AutoModelForSequenceClassification.from_pretrained(RERANK_MODEL_ID)
        self.model.eval()
        self.torch = torch
        self.expected_api_key = os.environ.get("RERANK_API_KEY")

    @modal.method()
    def score(
        self,
        query: str,
        candidates: list[dict],
        top_k: int | None = None,
    ) -> list[dict]:
        if not candidates:
            return []

        pairs = [(query, c["text"]) for c in candidates]
        with self.torch.no_grad():
            inputs = self.tokenizer(
                pairs, padding=True, truncation=True, return_tensors="pt", max_length=512
            )
            logits = self.model(**inputs).logits.squeeze(-1)
            scores = logits.tolist()
            # Single-candidate case returns a scalar, not a list.
            if not isinstance(scores, list):
                scores = [scores]

        results = [
            {"id": c["id"], "score": float(s)} for c, s in zip(candidates, scores)
        ]
        results.sort(key=lambda r: -r["score"])
        for i, r in enumerate(results):
            r["rank"] = i + 1

        if top_k is not None:
            results = results[:top_k]
        return results


@app.function(secrets=[api_key_secret])
@modal.fastapi_endpoint(method="POST")
async def rerank(req: dict, authorization: str | None = None):
    """HTTP entry point matching HttpReranker's wire contract."""
    from fastapi import HTTPException

    # Auth (optional). If RERANK_API_KEY is set, require Bearer token.
    expected = os.environ.get("RERANK_API_KEY")
    if expected:
        if not authorization or not authorization.startswith("Bearer "):
            raise HTTPException(status_code=401, detail="missing bearer token")
        if authorization.removeprefix("Bearer ").strip() != expected:
            raise HTTPException(status_code=401, detail="invalid bearer token")

    query = req.get("query")
    candidates = req.get("candidates")
    top_k = req.get("topK")
    if not isinstance(query, str) or not isinstance(candidates, list):
        raise HTTPException(status_code=400, detail="invalid request body")

    results = Reranker().score.remote(query, candidates, top_k)
    return {"results": results}


# Local smoke test — `modal run modal/rerank_app.py` to exercise the class
# without deploying. Useful for iterating on model-loading / scoring before
# standing up the endpoint.
@app.local_entrypoint()
def main():
    r = Reranker()
    out = r.score.remote(
        "Who is the recruiter at Anthropic for the PM Consumer role?",
        [
            {
                "id": "relevant",
                "text": "Laura Small: Recruiter at Anthropic for the PM Consumer role. First screen on 3/14.",
            },
            {"id": "irrelevant1", "text": "James has five siblings, including twin brother Alex."},
            {"id": "irrelevant2", "text": "Karen and John Stine married on 9/24/1977 in Boulder."},
        ],
    )
    print(out)
    top = out[0]
    print(
        f"top: {top['id']} @ rank {top['rank']}  "
        f"score {top['score']:.3f}  (spread {top['score'] - out[-1]['score']:.3f})"
    )
