# Engrams — Project Instructions

## Product Identity

- **Name:** Engrams (from neuroscience: a physical trace of memory in the brain)
- **npm:** `engrams` (unscoped, published); `@engrams/core`, `@engrams/dashboard`, `@engrams/landing` (workspace packages)
- **Domain:** getengrams.com
- **GitHub:** Sunrise-Labs-Dot-AI/engrams
- **License:** MIT — Copyright (c) 2026 Sunrise Labs
- **Tagline:** Universal, portable memory layer for AI agents with a consumer-grade control surface

## What Engrams Is

An open-source MCP server + localhost web dashboard that gives AI agents persistent, cross-tool memory with full user control. Any MCP-compatible tool (Claude Code, Cursor, Windsurf, Claude Desktop, Cline) connects to the same memory. Users browse, search, confirm, correct, and manage what their agents know through a real dashboard — not just chat commands.

## Current State (April 2026)

V1–V3 feature complete. 27 MCP tools, 105 tests (92 core + 13 server), hybrid search, 13 entity types, knowledge graph, confidence decay, dedup, PII detection, memory permanence tiers, context-packed search, entity profiles, and a full Next.js dashboard.

**Shipped:**
- Onboarding flow (`memory_onboard`, `memory_import`, dashboard empty state + review queue)
- Model abstraction + BYOK (`LLMProvider` interface, per-task routing, `memory_configure`)
- Permission enforcement (checkPermission on all read/write paths, interactive dashboard agents page)
- Landing page (`packages/landing`) + dashboard restyle (Pensieve design system)
- Copyright cleanup (MIT license + metadata on all packages)
- Pro tier: Clerk auth, BYOK config, API tokens, terms + privacy pages, API key encryption (AES-256-GCM + scrypt)
- npm published (`engrams` on npm, v0.4.0)
- Cloud migration tool (`memory_migrate`)
- Memory permanence tiers: canonical (pinned), active, ephemeral (TTL), archived
- Context-packed search (`memory_context`) — token-budget-aware retrieval
- Entity profiles (`memory_briefing`) — LLM-generated summaries with 24h cache
- Archive page + entity profile pages in dashboard
- 13 entity types (expanded from 8)

**Deferred (handoffs written, not dispatched):**
- Pro tier remaining: cloud sync (Turso), hosted dashboard Vercel deployment (`handoff-pro-tier.md`)

## Tech Stack

| Layer | Technology |
|-------|-----------|
| MCP Server | `@modelcontextprotocol/sdk`, TypeScript, Node.js, stdio transport |
| Database | `better-sqlite3`, Drizzle ORM (SQLite dialect), FTS5, sqlite-vec |
| Embeddings | `all-MiniLM-L6-v2` via Transformers.js (local, no API calls), 384 dims |
| LLM | Abstracted `LLMProvider` interface — Anthropic (lazy import), OpenAI, Ollama (raw fetch). Per-task model routing: extraction (cheap) vs analysis (capable) |
| Dashboard | Next.js 15 (App Router), React 19, Tailwind v4, custom UI components |
| Landing | Next.js 15, Tailwind v4, Pensieve design system |
| Testing | Vitest (105 tests across 10 files) |
| Build | pnpm workspaces + Turborepo |
| Distribution | npm (`engrams` package), npx one-liner install |

## Repo Structure

```
engrams/
├── packages/
│   ├── core/             # @engrams/core — schema, types, confidence engine, LLM abstraction, crypto, context-packing, entity profiles
│   ├── mcp-server/       # engrams (npm) — MCP server + CLI entry point
│   ├── dashboard/        # @engrams/dashboard — Next.js localhost app (port 3838)
│   └── landing/          # @engrams/landing — getengrams.com landing page
├── handoff-*.md          # Build handoff documents
├── LICENSE               # MIT
├── package.json          # pnpm workspace root
├── pnpm-workspace.yaml
├── turbo.json
└── CLAUDE.md             # This file
```

## Data Directory

All runtime data lives in `~/.engrams/`:

```
~/.engrams/
├── engrams.db           # SQLite database (auto-created on first run)
├── config.json          # LLM provider config, user preferences
├── credentials.json     # Device ID, salt (mode 0600) — Pro: + Turso creds
└── models/              # Cached embedding model (~22MB)
    └── all-MiniLM-L6-v2/
```

## Database Schema

Nine tables + two virtual tables:

- **memories** — core storage (id, content, detail, summary, domain, source_agent_id/name, cross_agent_id/name, source_type, source_description, confidence, confirmed_count, corrected_count, mistake_count, used_count, learned_at, confirmed_at, last_used_at, deleted_at, has_pii_flag, entity_type, entity_name, structured_data, embedding, updated_at, permanence, expires_at, archived_at, user_id)
- **memory_connections** — relationship graph (source_memory_id, target_memory_id, relationship, updated_at, user_id)
- **memory_events** — audit trail (id, memory_id, event_type, agent_id, agent_name, old_value, new_value, timestamp, user_id)
- **agent_permissions** — per-agent read/write by domain (agent_id, domain, can_read, can_write, user_id)
- **memory_summaries** — cached entity profiles (id, entity_name, entity_type, summary, memory_ids, token_count, generated_at, user_id)
- **user_settings** — BYOK provider config, tier, encrypted API keys (user_id, tier, byok_provider, byok_api_key_enc, byok_base_url, byok_extraction_model, byok_analysis_model, created_at, updated_at)
- **api_tokens** — API token management (id, user_id, name, token_hash, scopes, expires_at, revoked_at, created_at)
- **engrams_meta** — key-value metadata (key, value) — tracks last_modified for cache invalidation
- **memory_fts** — FTS5 virtual table over content, detail, entity_name, source_agent_name
- **memory_embeddings** — sqlite-vec virtual table (float[384])

IDs are `hex(randomblob(16))`. Timestamps are ISO 8601 TEXT. Confidence is REAL 0-1. Soft deletes via deleted_at.

## Entity Types

Memories are classified into 13 entity types: `person`, `organization`, `place`, `project`, `preference`, `event`, `goal`, `fact`, `lesson`, `routine`, `skill`, `resource`, `decision`. Each has:
- `entity_type` — the classification
- `entity_name` — canonical name for dedup (e.g., "Sarah Chen")
- `structured_data` — JSON with type-specific fields (role, org, category, etc.)

Entity extraction runs in the background via LLM on every `memory_write` (fire-and-forget). Auto-creates connections between entities (works_at, involves, located_at, part_of, about, informed_by, uses).

## MCP Tools (27)

| Tool | Description |
|------|-------------|
| `memory_search` | Hybrid semantic + keyword search with domain/confidence/entity filters |
| `memory_context` | Token-budget-aware context search (hierarchical or narrative output) |
| `memory_briefing` | Pre-computed entity profile summaries with 24h cache |
| `memory_write` | Create memory with dedup detection, permanence tier, and optional TTL |
| `memory_update` | Modify content, detail, or metadata |
| `memory_confirm` | Mark verified (confidence → 0.99) |
| `memory_correct` | LLM-powered semantic diff correction |
| `memory_flag_mistake` | Degrade confidence (-0.15) |
| `memory_remove` | Soft-delete with reason |
| `memory_pin` | Pin as canonical (decay-immune, high confidence) |
| `memory_archive` | Archive for reference (deprioritize in search, freeze confidence) |
| `memory_connect` | Link memories with typed relationships |
| `memory_get_connections` | Traverse the relationship graph |
| `memory_split` | LLM-powered compound memory splitting (two-phase: propose → confirm) |
| `memory_classify` | Auto-classify memories with entity types via LLM |
| `memory_list_entities` | Discover known entities by type |
| `memory_list` | Browse by domain, type, or confidence |
| `memory_list_domains` | List all domains with counts |
| `memory_set_permissions` | Per-agent read/write access control by domain |
| `memory_scrub` | Detect and redact PII patterns |
| `memory_onboard` | Guided onboarding: scan connected tools → informed interview → seed |
| `memory_interview` | Agent-driven cleanup + gap-fill: analyzes health, generates targeted question plan |
| `memory_import` | Batch import from Claude, ChatGPT, Cursor, gitconfig, plaintext |
| `memory_export` | Export memories as portable JSON |
| `memory_index` | Index external documents (Drive, Notion, filesystem) for unified search |
| `memory_index_status` | Check staleness of indexed documents |
| `memory_migrate` | Migrate local memories to cloud (Pro tier) |

## Memory Permanence

Memories have a `permanence` tier that controls decay and search behavior:
- **canonical** — pinned by user, immune to confidence decay, boosted in search
- **active** — default tier, normal decay and search ranking
- **ephemeral** — has a TTL (`expires_at`), auto-swept on decay cycle
- **archived** — frozen confidence, deprioritized in search, browsable via `/archive`

`memory_write` accepts `permanence` and `ttl` params. TTL format: `"1h"`, `"24h"`, `"7d"`, `"30d"`.

## Confidence Engine

### Initial confidence by source type
- stated: 0.90, observed: 0.75, inferred: 0.65, cross-agent: 0.70

### Updates
- confirm: confidence → 0.99
- correct: confidence → 0.50 (reset to neutral on correction)
- mistake: max(confidence - 0.15, 0.10)
- used: min(confidence + 0.02, 0.99)
- pin: confidence → max(current, 0.95), permanence → "canonical" (immune to decay)
- archive: permanence → "archived", confidence frozen
- decay: -0.01 per 30 days since last activity, min 0.10, throttled to once per hour on read paths
- TTL expiry: ephemeral memories with `expires_at` are swept (soft-deleted) on decay cycle

### Dedup + Contradiction Resolution
On `memory_write`: hybrid search (RRF > 0.7) + entity name/type match. If similar found, returns `similar_found` with 5 resolution options: update, correct, add_detail, keep_both, skip. Agent-in-the-loop, resolved in real-time.

## Search Architecture

Hybrid search via Reciprocal Rank Fusion (k=60):
1. FTS5 keyword search → ranked results
2. sqlite-vec cosine similarity → ranked results
3. Merge with RRF: `score = Σ 1/(k + rank_i)`
4. Confidence-weighted scoring + recency boost
5. Graph expansion (cosine threshold, max 3 hops)
6. Embedding LRU cache (5-min TTL), result cache (invalidated on writes via engrams_meta.last_modified)

## LLM Provider Abstraction

`LLMProvider` interface with two implementations:
- `AnthropicProvider` — lazy dynamic import of `@anthropic-ai/sdk`
- `OpenAICompatibleProvider` — raw fetch against `/v1/chat/completions` (no dependency). Works with OpenAI, Groq, Together, Azure, Ollama, LMStudio.

Per-task model routing (`LLMTask = "extraction" | "analysis"`):
- **Extraction** (every write): entity classification, proactive split detection → cheap model (Haiku, GPT-4o-mini)
- **Analysis** (user-initiated): correction, splitting, cleanup → capable model (Sonnet, GPT-4o)

Config priority: `~/.engrams/config.json` → `ENGRAMS_*` env vars → `ANTHROPIC_API_KEY`/`OPENAI_API_KEY` → null (LLM features disabled gracefully).

Output validation: `validateExtraction()`, `validateSplit()`, `validateCorrection()` check structural validity. `checkSemanticPreservation()` uses embeddings for split quality.

## Dashboard

Next.js 15 on localhost:3838. Reads SQLite directly via better-sqlite3 (local mode) or Turso (hosted mode). Server actions handle mutations. Clerk auth in hosted mode (conditional on `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`).

### Routes
| Route | Purpose |
|-------|---------|
| `/` | Memory browser (search, filter by domain/entity/confidence, inline edit) |
| `/memory/[id]` | Detail view (provenance, connections, events, edit) |
| `/agents` | Agent permission management |
| `/archive` | Archived memories browser with restore actions |
| `/cleanup` | Health score, dedup, merge, split, contradiction, PII detection + inline actions |
| `/entities/[name]` | Entity profile page (summary, related memories, connections) |
| `/settings` | DB stats, export, LLM provider config, sync config (Pro) |
| `/sign-in`, `/sign-up` | Clerk authentication (hosted mode only) |
| `/api/export` | Memory export API |

## Design System (Pensieve)

Dashboard and landing page share the Pensieve design system:
- **Background:** Deep indigo-black (`#0a0e1a`)
- **Cards:** Glassmorphic (`backdrop-blur-xl`, semi-transparent bg, glow borders on hover)
- **Accent:** Silver-blue (`#7dd3fc` to `#bae6fd`)
- **Secondary:** Warm violet (`#a78bfa`)
- **Typography:** Inter (body), JetBrains Mono (code)
- **Effects:** Floating orb CSS animations, gradient glow buttons, blurred modal overlays
- All colors via CSS custom properties — never hardcoded hex in components
- `clsx` for conditional class merging

## Coding Standards

- TypeScript strict mode
- No `any` types — use proper generics or `unknown` + type guards
- All database queries through Drizzle ORM (no raw SQL except FTS5/sqlite-vec setup)
- All timestamps as ISO 8601 strings in SQLite
- All IDs as `hex(randomblob(16))` — 32-char hex strings
- Error messages should be actionable ("No LLM provider configured. Set ANTHROPIC_API_KEY..." not "key error")
- No console.log in production paths
- Variant + size lookup tables (`Record<Variant, string>`) for UI components
- CSS custom properties for all colors
- Extend native HTML attributes on component props
- Soft deletes with `deleted_at` timestamps

## Notion References

- Product page: `33d041760b7080628a3fcb3f7a00df17`
- System architecture: `33d041760b70817098a0d28cf778e3cf`
- Co-work instructions: `33d041760b7081c98eb3d19f89cfa002`
