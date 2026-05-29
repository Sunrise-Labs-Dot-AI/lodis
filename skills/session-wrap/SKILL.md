---
name: session-wrap
description: Use at the end of a work session, before context is lost, to distill what happened into durable memory. Rates any open `memory_context` retrievals and writes the session's durable facts, decisions, and lessons via `memory_write`. Trigger on "wrap up", "end of session", "save what we learned", or before a long-running session closes.
---

# Lodis — Session Wrap

You have access to the Lodis MCP tools. A session's value evaporates when it ends unless the load-bearing parts are written somewhere durable. This skill's job is to ensure everything worth keeping lives in Lodis (or another durable artifact like a committed file or PR) — **not stranded only in the transcript.**

## Step 1 — Rate open retrievals

For each `memory_context` call made earlier this session (its response carried `meta.retrievalId`), close the loop with one `memory_rate_context` call:
```
memory_rate_context({
  retrievalId: <the id>,
  referenced: [<IDs you actually cited>],
  noise: [<IDs you filtered as irrelevant>],
})
```
One call per retrieval, not per memory. Add a short `notes` only when retrieval quality was notably good or bad. Idempotent: an identical repeat is a safe no-op.

**Skip if:** no `memory_context` retrieval happened this session, or the retrievalIds aren't recoverable from the transcript. Say so in the summary.

## Step 2 — Write the durable takeaways

Scan the session for things a future session would need and `memory_write` each one (one discrete fact per call — see the `memory-capture` skill for full write discipline):
- **decision** — a choice made this session and why
- **lesson** — a gotcha or non-obvious insight discovered
- **fact** — a durable truth about a person, project, or org that changed or was established
- **preference** — a new working-style preference the user stated
- **resource** — a new canonical source worth pointing at (store the path/URL in `structuredData`, don't copy the content)

`memory_search` first if you're unsure something is already stored — resolve duplicates rather than piling on. Supply `entityType` + `entityName` and `connections` so each memory is typed and linked.

**Do NOT write:**
- Anything derivable from the code or git history
- Ephemeral task state ("currently editing file X")
- Things already in Lodis

**Skip if:** nothing non-obvious came up. Report "no new memories warranted."

## Step 3 — Confirm durability, then a thin pointer (only if pausing mid-work)

Before finishing, verify every load-bearing decision from this session lives in a durable artifact — a Lodis memory, a committed file, or a PR — and not only in this conversation. If something is stranded, write it now.

If you're **pausing mid-stream** (work unfinished, handing to a later session or another person), emit a short handoff that *points* at the durable artifacts rather than re-deriving them:
```
Handoff — <project> — <YYYY-MM-DD>
- Resume from: Lodis memory <id> (run the memory-retrieval skill first)
- Branch / open PRs: <branch> · #<pr>
- Next: <the one concrete next step>
- Blockers: <or none>
```
If the work is **complete** (nothing open), skip the handoff — a one-line closeout is enough.

## Final summary

Print what ran and what was skipped (with one-line reasons):
```
Session wrap:
- Ratings: <N retrievals rated | skipped: reason>
- Writes: <N memories written (ids) | skipped: reason>
- Durability: <all load-bearing items in artifacts | wrote N to close gaps>
- Handoff: <thin pointer above | closeout: complete | skipped: still working>
```

## Notes

- Use absolute dates (`2026-05-28`), never "today".
- This skill writes only to Lodis and standard project artifacts (committed files, PRs). It does not assume any particular note-taking app, vault, or plan-file layout — keep durability in Lodis and the repo.
