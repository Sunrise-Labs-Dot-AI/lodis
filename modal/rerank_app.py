"""
Reference cross-encoder reranker service for Lodis, deployable on Modal.

Wire contract (matches HttpReranker in packages/core/src/reranker.ts):

  POST /rerank
  Headers:
    content-type: application/json
    authorization: Bearer <RERANK_API_KEY>              (REQUIRED — fail-closed)
  Body:
    {
      "query": "string",                                 (≤ 4000 chars)
      "candidates": [{"id": "string", "text": "string"}], (≤ 200 items; text ≤ 8000)
      "topK": 40                                         (optional)
    }

  200 OK:
    {
      "results": [{"id": "string", "score": float, "rank": int}, ...]
    }
    (results are sorted by descending score; rank is 1-indexed)

  400 — malformed body (missing/wrong-type fields)
  401 — missing/invalid bearer token
  413 — too many candidates OR candidate text too long
  500 — server misconfigured (RERANK_API_KEY secret missing) OR internal error
        (exception messages are NOT propagated — they may contain query/PII)

Security posture:
  - Fail-closed auth: if the RERANK_API_KEY env var is unset inside the
    container, every request returns 500. `required_keys=["RERANK_API_KEY"]`
    on the Modal secret makes Modal itself refuse to boot the container
    without the key.
  - Bearer comparison uses `hmac.compare_digest` (constant-time) to avoid
    the timing side-channel that `!=` on strings allows.
  - Input-size caps protect against DoS and cost amplification — a caller
    with a valid key cannot OOM the container or drive compute bills by
    sending 100k candidates of 10kB each.
  - No request-body logging. The `score.remote` call is wrapped in a
    generic try/except that returns 500 with a stable message; exception
    text (which may contain the query) is swallowed.

Deployment:

  pip install modal
  modal setup                         # one-time auth (or: modal token set)
  modal deploy modal/rerank_app.py    # from the repo root

  # Then set these in Vercel env vars for the dashboard:
  LODIS_RERANKER_URL=https://<workspace>--lodis-reranker-rerank.modal.run
  LODIS_RERANKER_API_KEY=<same hex value you stored in the Modal secret>

Keep-warm:
  keep_warm=1 holds one container ready so the first request does not pay the
  ~3-5s model-load cost. Modal charges for warm idle time — ~$0.10/day on CPU,
  cheap insurance vs. cold-start UX regressions. Scale to 0 by removing
  keep_warm if traffic is sparse and latency sensitivity is low.

Scaling:
  container_idle_timeout controls how long an idle container stays warm after
  serving. 300s is a reasonable default — covers bursty traffic without
  burning money during quiet periods. allow_concurrent_inputs packs multiple
  requests onto one container when possible.
"""

import hmac
import os

import modal
from fastapi import Header, HTTPException

RERANK_MODEL_ID = "BAAI/bge-reranker-base"

# Input-size caps — guards against DoS + cost amplification. These apply
# even to authenticated callers; a compromised Lodis instance sending a
# runaway payload cannot blow memory on the 1GB container or drive Modal
# bills by reranking 100k pairs per request. Adjust only if Lodis's typical
# pre-rerank candidate pool grows past 200 (currently capped at limit=200
# in context-packing.ts).
MAX_CANDIDATES = 200
MAX_QUERY_CHARS = 4000
MAX_CANDIDATE_TEXT_CHARS = 8000

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

# Bearer-token auth is MANDATORY and fail-closed. `required_keys=[...]`
# tells Modal to refuse to boot the container if the secret is missing —
# catches "deployed to a workspace that never ran `modal secret create`"
# at startup rather than as a 500 on every request.
api_key_secret = modal.Secret.from_name("rerank-api-key", required_keys=["RERANK_API_KEY"])


@app.cls(
    cpu=2.0,
    memory=1024,
    # Modal 1.x renames:
    #   keep_warm=1          → min_containers=1      (warm floor)
    #   container_idle_timeout=300 → scaledown_window=300 (idle → stop delay)
    #   allow_concurrent_inputs=10 → @modal.concurrent(max_inputs=10) decorator
    # Holds one warm container so the first request each deploy-cycle skips
    # the ~3-5s model-load cold start.
    min_containers=1,
    scaledown_window=300,
    secrets=[api_key_secret],
)
@modal.concurrent(max_inputs=10)
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
async def rerank(
    req: dict,
    # FastAPI's default inference treats a plain `str | None = None` as a
    # QUERY param, not a header. `Header(default=None)` is required for
    # FastAPI to read the actual HTTP `Authorization` header. Without this
    # the gate always sees None and returns 401 for every authenticated
    # request — caught by smoke-test 4a.
    authorization: str | None = Header(default=None),
):
    """HTTP entry point matching HttpReranker's wire contract."""

    # Auth — fail-closed. If RERANK_API_KEY is missing from the env (e.g.
    # the Modal secret was deleted, or deployed to a workspace where Step 2
    # of the deploy plan was skipped), every request 500s. No anonymous
    # path. `required_keys=[...]` on the secret makes this nearly
    # impossible at the platform level; the in-handler check is defense in
    # depth for the "secret exists but env var name drifted" edge case.
    expected = os.environ.get("RERANK_API_KEY")
    if not expected:
        raise HTTPException(status_code=500, detail="server misconfigured: RERANK_API_KEY missing")

    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="missing bearer token")

    # Constant-time comparison — `!=` on strings short-circuits on first
    # mismatched byte, leaking the key one byte at a time via latency.
    provided = authorization.removeprefix("Bearer ").strip()
    if not hmac.compare_digest(provided, expected):
        raise HTTPException(status_code=401, detail="invalid bearer token")

    # --- Validate + enforce input-size caps ---
    query = req.get("query")
    candidates = req.get("candidates")
    top_k = req.get("topK")

    if not isinstance(query, str):
        raise HTTPException(status_code=400, detail="invalid request body: query must be a string")
    if len(query) > MAX_QUERY_CHARS:
        raise HTTPException(
            status_code=413, detail=f"query too long (max {MAX_QUERY_CHARS} chars)"
        )
    if not isinstance(candidates, list):
        raise HTTPException(status_code=400, detail="invalid request body: candidates must be a list")
    if len(candidates) > MAX_CANDIDATES:
        raise HTTPException(
            status_code=413, detail=f"too many candidates (max {MAX_CANDIDATES})"
        )
    for i, c in enumerate(candidates):
        if not (
            isinstance(c, dict)
            and isinstance(c.get("id"), str)
            and isinstance(c.get("text"), str)
        ):
            # Deliberately generic — do NOT echo the malformed value,
            # which could be attacker-controlled and end up in logs.
            raise HTTPException(status_code=400, detail=f"invalid candidate shape at index {i}")
        if len(c["text"]) > MAX_CANDIDATE_TEXT_CHARS:
            raise HTTPException(
                status_code=413,
                detail=f"candidate text too long (max {MAX_CANDIDATE_TEXT_CHARS} chars)",
            )
    if top_k is not None and (not isinstance(top_k, int) or top_k < 1):
        raise HTTPException(status_code=400, detail="invalid topK: must be a positive integer")

    # Wrap the remote call in a blanket except that does NOT propagate the
    # exception message. Tracebacks from BGE / tokenizer / Modal infra may
    # contain the query or candidate text; we keep those out of the response
    # body and rely on `modal app logs` for debugging (and even those should
    # be spot-checked post-deploy — see modal/README.md).
    try:
        results = Reranker().score.remote(query, candidates, top_k)
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=500, detail="internal error")
    return {"results": results}


# Local smoke test — `modal run modal/rerank_app.py` to exercise the class
# without deploying. Useful for iterating on model-loading / scoring before
# standing up the endpoint. Uses synthetic data so neither the local shell
# history nor Modal's log capture user content.
@app.local_entrypoint()
def main():
    r = Reranker()
    out = r.score.remote(
        "What is the capital of France?",
        [
            {"id": "relevant", "text": "Paris is the capital and largest city of France."},
            {"id": "irrelevant1", "text": "Dogs are mammals that typically live 10-13 years."},
            {"id": "irrelevant2", "text": "The Eiffel Tower is 330 meters tall."},
        ],
    )
    print(out)
    top = out[0]
    print(
        f"top: {top['id']} @ rank {top['rank']}  "
        f"score {top['score']:.3f}  (spread {top['score'] - out[-1]['score']:.3f})"
    )
