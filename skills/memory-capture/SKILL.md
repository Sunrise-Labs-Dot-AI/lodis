---
name: memory-capture
description: Use when something worth remembering comes up in a session — a user preference, a correction, a decision, a durable fact about a person/project/organization, a lesson learned, or a progress event. Teaches you to choose between `memory_write` (durable facts) and `memory_write_snippet` (timestamped progress events), classify entities, resolve duplicates, and link memories into the graph. Trigger on "remember that…", "note that…", a user correction, or when you learn a non-obvious fact you'll want next session.
---

# Lodis — Memory Capture

You have access to the Lodis MCP tools. This skill is the write discipline: **what** to store, **which tool** to use, and **how** to keep the store clean (typed, deduplicated, connected). Lodis never runs an LLM on the write path — entity typing, dedup resolution, and connections all come from you, the calling agent.

## First: is this worth writing?

**Write** non-obvious things a future session would benefit from:
- **preference** — a working-style choice the user stated
- **decision** — a choice made and its rationale
- **fact** — a durable truth about a person, project, or org
- **lesson** — a gotcha or insight discovered this session
- **resource** — a pointer to a canonical external source (doc, dashboard, repo)

**Do NOT write:**
- Things derivable from code or git history
- Things already stored — `memory_search` first if unsure
- Ephemeral task state from this session

**Prefer pointers over copies.** If the fact lives in a canonical source (a style guide, a config file, a spec), write a `resource` memory pointing to it (put the path/URL in `structuredData`) rather than duplicating the content. Lodis should be a graph of pointers, not a second copy of everything.

## Choose the tool: durable fact vs. progress event

Keep this line sharp — it decides whether the memory shows up in default search:

- **`memory_write`** → a durable fact / preference / decision / lesson / entity. **Default-searchable.**
- **`memory_write_snippet`** → "an event happened at time T" (shipped / advanced / started / stalled / blocked). Ephemeral, **partitioned out of default search**, queried via `memory_query_progress` / `memory_progress_summary`.
- **If one observation contains both** (e.g. "shipped the auth refactor — and learned Clerk sessions need X"), **write both**: a snippet for the event, a `memory_write` lesson/fact for the durable part.

## Using `memory_write`

Required: `content`, `sourceAgentId`, `sourceAgentName`, `sourceType` (`stated` | `inferred` | `observed` | `cross-agent`).
Strongly recommended: `entityType` (one of the 14 types) + `entityName` (canonical, e.g. `"Sarah Chen"`, not `"my manager"`) — these drive dedup and the graph. If you omit them the server stores the row and hints to classify later, but supplying them up front is better.
Optional: `domain`, `detail`, `permanence` (`canonical` | `active` | `ephemeral`), `ttl` (`"24h"`, `"7d"`, `"30d"` — implies ephemeral), `structuredData`, `connections`.

```
memory_write({
  content: "Alex prefers async written updates over standup calls.",
  entityType: "preference", entityName: "Alex Rivera",
  domain: "work", sourceType: "stated",
  sourceAgentId: "<your-id>", sourceAgentName: "<your-name>",
  connections: [{ targetEntityName: "Alex Rivera", relationship: "about" }],
})
```

## Resolve duplicates (the `similar_found` response)

If a similar memory exists, `memory_write` returns `status: "similar_found"` with the existing memory and options instead of writing. Pick a `resolution` and call again with `existingMemoryId`:
- **update** — same fact, better wording → replace content
- **correct** — the old one was wrong → replace + raise confidence
- **supersede** — the world changed (role/status/value) → preserve old as historical (`valid_to`), store new as current
- **add_detail** — append to the existing memory's detail
- **keep_both** — genuinely distinct → force a new memory
- **skip** — existing is already accurate → write nothing

Choose deliberately; don't reflexively `keep_both` (that's how duplicates accumulate).

## Using `memory_write_snippet`

Required: `snippet_type`, `life_domain` (a registered slug), `content`, `source_system`, `event_timestamp` (ISO 8601), `sourceAgentId`, `sourceAgentName`.
The `life_domain` must already be registered (and not archived) via `memory_register_domain`, or the write is rejected — register it first if needed.
Always pass `connections` to link the event to the durable entities it concerns, so it isn't graph-isolated:

```
memory_write_snippet({
  snippet_type: "shipped", life_domain: "engineering",
  content: "Shipped the rate-limiter for the public API.",
  source_system: "github", event_timestamp: "<ISO>",
  sourceAgentId: "<your-id>", sourceAgentName: "<your-name>",
  connections: [{ targetEntityName: "Public API", relationship: "about" }],
})
```

## Connect memories

When you write a memory related to entities already in the graph, populate `connections` (up to 50): each is `{ targetEntityName | targetMemoryId, relationship }`. Common relationships: `about`, `involves`, `part_of`, `works_at`, `references`, `supports`, `contradicts`, `related`. Prefer `targetMemoryId` when you have it; otherwise `targetEntityName` resolves case-insensitively.

## One fact per write

Write one discrete fact per call — don't batch several facts into one `content`. If you're tempted to use "and", that's usually two memories (and possibly a compound that `memory_split` should break apart later).
