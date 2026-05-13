# Lodis

[![npm version](https://img.shields.io/npm/v/@sunriselabs/lodis.svg)](https://www.npmjs.com/package/@sunriselabs/lodis)
[![license](https://img.shields.io/npm/l/@sunriselabs/lodis.svg)](https://github.com/Sunrise-Labs-Dot-AI/lodis/blob/main/LICENSE)

**Universal, portable memory layer for AI agents.**

Lodis gives your AI tools persistent, cross-tool memory backed by local SQLite. Any MCP-compatible tool — Claude Code, Cursor, Windsurf, Claude Desktop, Cline — connects to the same memory. Your agents remember what you tell them, learn from corrections, and build confidence over time.

## Quick Start

Add to your MCP config and you're done:

```json
{
  "mcpServers": {
    "lodis": {
      "command": "npx",
      "args": ["-y", "@sunriselabs/lodis"]
    }
  }
}
```

That's it. Your AI agent now has persistent memory.

> **Migrating from `engrams`?** This project was published as `engrams` on npm prior to v0.6.0. The package was renamed to `lodis-mcp` — same code, same data directory (`~/.lodis/`), same MCP tools. To migrate, swap `engrams` for `lodis-mcp` in your MCP config (`"args": ["-y", "lodis-mcp"]`) and reinstall. The old `engrams` package on npm is frozen at v0.5.1 and will not receive further updates.

## Getting Started

After installing, tell your AI assistant:

> "Help me set up Lodis"

The assistant will scan your connected tools (calendar, email, GitHub), ask a few targeted questions, and seed 30-50 memories with entity types and connections supplied by the agent. Review at `localhost:3838`.

### Importing Existing Memories

- **Claude Code auto-memory:** "Import my Claude memories into Lodis"
- **ChatGPT memory export:** "Import this ChatGPT memory export into Lodis"
- **Cursor rules:** "Import my .cursorrules as Lodis preferences"

## What You Get

Lodis provides 39 MCP tools:

| Tool | Description |
|------|-------------|
| `memory_search` | Hybrid semantic + keyword search with filters |
| `memory_get` | Fetch one or many memories by ID (up to 50, deduplicated) |
| `memory_context` | Token-budget-aware context retrieval |
| `memory_rate_context` | Close the feedback loop on a prior `memory_context` retrieval |
| `memory_briefing` | Cached entity profiles, or source memories for the calling agent to summarize |
| `memory_write` | Create a new memory with dedup detection and permanence tiers |
| `memory_bulk_upload` | Upload many memories at once (bypasses dedup) for imports from canonical external sources |
| `memory_update` | Structural edit — content, detail, domain, or entity fields |
| `memory_remove` | Soft-delete a memory |
| `memory_remove_bulk` | Soft-delete many memories at once, scoped by domain / entityName / ids[]. Defaults to dryRun. |
| `memory_confirm` | Confirm a memory is correct (boosts confidence to 0.99) |
| `memory_correct` | Replace content with corrected or user-asserted information; raises confidence to ≥0.90 |
| `memory_flag_mistake` | Flag a memory as incorrect (degrades confidence) |
| `memory_pin` | Pin as canonical (decay-immune, high confidence) |
| `memory_archive` | Archive for reference (deprioritize, freeze confidence) |
| `memory_connect` | Create typed relationships between memories |
| `memory_connect_batch` | Commit multiple relationship edges in one call |
| `memory_get_connections` | Traverse the knowledge graph |
| `memory_propose_connections` | Server-side candidate selection for the agent connection loop |
| `memory_split` | Break compound memories into atomic units |
| `memory_scrub` | Detect and redact PII or secrets from memory content |
| `memory_list` | Browse memories by domain, sorted by confidence or recency |
| `memory_list_domains` | List all memory domains with counts and registered/archived status |
| `memory_list_entities` | List extracted entities grouped by type |
| `memory_classify` | List untyped memories so the calling agent can classify them |
| `memory_set_permissions` | Configure per-agent read/write access |
| `memory_write_snippet` | Write a validated progress event (shipped/advanced/started/stalled/blocked) |
| `memory_query_progress` | Time-ranged snippet query filtered by domain or linked goal |
| `memory_progress_summary` | Rollup: totals by domain, type, and goal — for weekly reviews |
| `memory_register_domain` | Register a life domain slug so snippet writes are accepted |
| `memory_archive_domain` | Archive a domain so snippet writes are rejected until unarchived |
| `memory_onboard` | Guided onboarding: scan tools, interview, seed memories |
| `memory_interview` | Agent-driven cleanup and gap-fill |
| `memory_import` | Import from Claude, ChatGPT, Cursor, gitconfig, or plaintext |
| `memory_export` | Export memories as portable JSON |
| `memory_index` | Index external docs (Drive, Notion, filesystem) |
| `memory_index_status` | Check staleness of indexed documents |
| `memory_migrate` | Migrate local memories to cloud (Pro tier) |
| `memory_tutorial` | Interactive chapter-by-chapter tutorial for how Lodis works |

### Key features

- **Hybrid search** — FTS5 full-text + vector embeddings (all-MiniLM-L6-v2, local) merged via Reciprocal Rank Fusion
- **Entity types** — Memories support 14 types: person, organization, place, project, preference, event, goal, fact, lesson, routine, skill, resource, decision, snippet
- **Knowledge graph** — Typed relationships between memories, with deterministic same-entity links and agent-reviewed connection proposals
- **Memory permanence** — Four tiers (canonical, active, ephemeral, archived) control confidence decay and search ranking
- **Context-packed search** — Token-budget-aware retrieval via `memory_context` for efficient LLM context windows
- **Entity profiles** — Cached summaries of known entities via `memory_briefing`, with raw evidence returned when the calling agent needs to synthesize one
- **Confidence scoring** — 0-1 scale based on confirmations, corrections, mistakes, usage, and time decay
- **Dedup on write** — Similar memories detected and surfaced to the agent for resolution
- **Document indexing** — Index external documents (Drive, Notion, filesystem) for unified search
- **PII detection** — Regex-based pattern detection with `memory_scrub` for redaction
- **Source attribution** — Every memory tracks which agent learned it and how

## MCP Config Examples

### Claude Code

In `~/.claude.json` or your project's `.mcp.json`:

```json
{
  "mcpServers": {
    "lodis": {
      "command": "npx",
      "args": ["-y", "@sunriselabs/lodis"]
    }
  }
}
```

### Claude Desktop

In `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "lodis": {
      "command": "npx",
      "args": ["-y", "@sunriselabs/lodis"]
    }
  }
}
```

### Cursor

In `.cursor/mcp.json` in your project root:

```json
{
  "mcpServers": {
    "lodis": {
      "command": "npx",
      "args": ["-y", "@sunriselabs/lodis"]
    }
  }
}
```

### Windsurf

In `~/.windsurf/mcp.json`:

```json
{
  "mcpServers": {
    "lodis": {
      "command": "npx",
      "args": ["-y", "@sunriselabs/lodis"]
    }
  }
}
```

## How It Works

- **Local-first**: All data stored in `~/.lodis/lodis.db` (SQLite). No accounts, no cloud, no API keys for core functionality.
- **Hybrid search**: FTS5 keyword search + sqlite-vec vector embeddings, merged with Reciprocal Rank Fusion (k=60). Confidence-weighted scoring and recency boost.
- **Embeddings**: all-MiniLM-L6-v2 via Transformers.js — runs locally, no API calls, no cost. ~22MB model cached on first search.
- **Confidence scoring**: Memories start with confidence based on source type (stated: 90%, observed: 75%, inferred: 65%). Confirmations boost to 99%, user-stated corrections promote confidence, mistakes degrade confidence, and unused memories decay over time.
- **Semantic interpretation**: Calling agents provide entity types, structured data, corrections, summaries, and connection choices. Lodis keeps the server read/write paths LLM-free.
- **Source attribution**: Every memory tracks which agent wrote it and how it was acquired.
- **Audit trail**: All changes logged in an event timeline.
- **Cross-tool**: Every MCP-compatible tool shares the same memory database.

## Semantic Reasoning

Lodis does not call an LLM from its core read/write paths. It exposes structured MCP tools and safe candidate sets; your AI client performs semantic tasks like classification, correction wording, split decisions, connection review, and briefing synthesis, then writes the audited result back to Lodis. Core features (search, store, connect) work without configuring any model provider inside Lodis.

## Web Dashboard

Lodis includes a web dashboard for browsing and managing your memories visually. Clone the repo to use it:

```bash
git clone https://github.com/Sunrise-Labs-Dot-AI/lodis.git
cd lodis && pnpm install && pnpm build

# Start the dashboard
cd packages/dashboard && pnpm dev
```

Open [localhost:3838](http://localhost:3838) to browse memories, search, confirm, correct, manage agent permissions, explore the knowledge graph, view entity profiles, browse archived memories, and run cleanup operations.

## Contributing

Contributions welcome! Please open an issue or pull request on [GitHub](https://github.com/Sunrise-Labs-Dot-AI/lodis).

## License

MIT
