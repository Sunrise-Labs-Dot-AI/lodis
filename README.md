# Lodis

Universal, portable memory layer for AI agents.

Lodis gives your AI tools a shared memory — searchable, correctable, and under your control. Install once, connect to Claude Code, Cursor, Windsurf, or any MCP-compatible client.

## Quick Start

Add to your Claude Code config (`~/.claude.json`):

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

That's it. Your AI now has persistent memory.

> **Migrating from `engrams`?** This project was published as `engrams` on npm prior to v0.6.0. The package was renamed to `lodis-mcp` — same code, same data directory (`~/.lodis/`), same MCP tools. To migrate, swap `engrams` for `lodis-mcp` in your MCP config (`"args": ["-y", "lodis-mcp"]`) and reinstall. The old `engrams` package on npm is frozen at v0.5.1 and will not receive further updates.

## Getting Started

After installing, tell your AI assistant:

> "Help me set up Lodis"

The assistant will call `memory_onboard` and:
1. **Scan** your connected tools (calendar, email, GitHub) to extract people, projects, and context
2. **Interview** you with targeted questions based on what it found
3. **Seed** 30-50 memories with entity types and connections

Review your memories at `localhost:3838`. Confirm what's right, correct what's wrong.

### Importing Existing Memories

If you have memories in other tools, your AI can import them:

- **Claude Code auto-memory:** "Import my Claude memories into Lodis"
- **ChatGPT memory export:** "Import this ChatGPT memory export into Lodis"
- **Cursor rules:** "Import my .cursorrules as Lodis preferences"

The `memory_import` tool handles parsing and deduplication. Where semantic judgment is needed, the calling agent supplies entity fields or follows up with `memory_classify` / `memory_update`.

## What It Does

- **Remembers across tools.** Teach Claude something, Cursor knows it too.
- **Searches semantically.** Hybrid search (full-text + vector embeddings) finds relevant memories even with different wording.
- **Knows what it knows.** Confidence scoring, source attribution, and entity classification on every memory.
- **Lets you correct it.** Confirm, correct, split, or remove memories through the dashboard or MCP tools.
- **Deduplicates on write.** Similar memories are detected and surfaced to the agent for resolution.
- **Builds a knowledge graph.** Memories connect to each other with typed relationships. 14 entity types (people, organizations, projects, preferences, snippets, and more) can be supplied by agents and linked by deterministic helpers or agent-reviewed connection proposals.
- **Manages memory permanence.** Four tiers — canonical, active, ephemeral (TTL), and archived — control confidence decay and search ranking.
- **Packs context efficiently.** Token-budget-aware retrieval via `memory_context` delivers the right amount of context for any LLM window.
- **Generates entity profiles.** On-demand summaries of known people, projects, and organizations via `memory_briefing`.
- **Indexes external documents.** Pull in context from Google Drive, Notion, or local files for unified search.

## Dashboard

Start the dashboard to browse, search, and manage memories:

```bash
cd packages/dashboard && pnpm dev
```

Opens at [localhost:3838](http://localhost:3838).

Features:
- Memory browser with filtering by domain, entity type, confidence, and usage
- Memory detail view with provenance, connections, and event timeline
- Inline editing — click to edit any memory
- Correction, splitting, and classification workflows that let the calling agent apply semantic judgment while Lodis stores the audited result
- Knowledge graph visualization
- Cleanup page for deduplication and maintenance
- Archive page for browsing archived memories with restore actions
- Entity profile pages with cached summaries and evidence memories
- Settings page with database stats, export, sync, and API token management

## MCP Tools

Lodis provides 39 MCP tools:

| Tool | Description |
|------|-------------|
| `memory_search` | Hybrid semantic + keyword search with filters |
| `memory_get` | Fetch one or many memories by ID (up to 50, deduplicated) |
| `memory_context` | Token-budget-aware context retrieval |
| `memory_rate_context` | Close the feedback loop on a prior `memory_context` retrieval |
| `memory_briefing` | Cached entity profile summaries, or source memories for the calling agent to summarize |
| `memory_write` | Store a memory (with dedup detection and permanence tiers) |
| `memory_bulk_upload` | Upload many memories at once for imports from canonical external sources |
| `memory_update` | Modify content, detail, or metadata |
| `memory_confirm` | Mark a memory as verified (confidence → 0.99) |
| `memory_correct` | Replace content with corrected or user-asserted information |
| `memory_flag_mistake` | Degrade confidence |
| `memory_remove` | Soft-delete |
| `memory_remove_bulk` | Soft-delete many memories at once, scoped by domain / entityName / ids[]. Defaults to dryRun. |
| `memory_pin` | Pin as canonical (decay-immune, high confidence) |
| `memory_archive` | Archive for reference (deprioritize, freeze confidence) |
| `memory_connect` | Link memories with typed relationships |
| `memory_connect_batch` | Commit multiple relationship edges in one call |
| `memory_propose_connections` | Server-side candidate selection for the agent connection loop |
| `memory_get_connections` | Traverse the relationship graph |
| `memory_split` | Break compound memories into atomic parts |
| `memory_classify` | List untyped memories so the calling agent can classify them |
| `memory_list_entities` | Discover known entities |
| `memory_list` | Browse by domain, type, or confidence |
| `memory_list_domains` | List all domains with counts and registered/archived status |
| `memory_set_permissions` | Per-agent access control |
| `memory_scrub` | Detect and redact PII |
| `memory_write_snippet` | Write a validated progress event |
| `memory_query_progress` | Time-ranged snippet query by domain or goal |
| `memory_progress_summary` | Roll up progress by domain, type, and goal |
| `memory_register_domain` | Register a life-domain slug for snippet writes |
| `memory_archive_domain` | Archive a domain so snippet writes are rejected until unarchived |
| `memory_onboard` | Guided onboarding: scan tools, interview, seed memories |
| `memory_interview` | Agent-driven cleanup and gap-fill |
| `memory_import` | Batch import from Claude, ChatGPT, Cursor, gitconfig, or plaintext |
| `memory_export` | Export memories as portable JSON |
| `memory_index` | Index external docs (Drive, Notion, filesystem) |
| `memory_index_status` | Check staleness of indexed documents |
| `memory_migrate` | Migrate local memories to cloud (Pro tier) |
| `memory_tutorial` | Interactive chapter-by-chapter tutorial for how Lodis works |

## Architecture

- **Storage:** SQLite/libSQL via `@libsql/client`, local at `~/.lodis/lodis.db`
- **Search:** FTS5 + sqlite-vec + Reciprocal Rank Fusion
- **Embeddings:** all-MiniLM-L6-v2 via Transformers.js (local, no API calls)
- **Semantic interpretation:** caller-side agent reasoning; Lodis itself stays LLM-free on read/write paths
- **Dashboard:** Next.js 15, Tailwind v4
- **Transport:** MCP stdio protocol

## Configuration

### Client configs

**Claude Desktop** (`~/Library/Application Support/Claude/claude_desktop_config.json`):
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

**Cursor** (`.cursor/mcp.json`):
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

**Windsurf** (`~/.windsurf/mcp.json`):
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

### Semantic Reasoning

Lodis does not call an LLM from its core read/write paths. It exposes structured tools and safe candidate sets; your AI client performs semantic tasks like classification, connection review, correction wording, and briefing synthesis, then writes the result back to Lodis. Core features (search, store, connect, sync) work without configuring any model provider inside Lodis.

## Data

All data lives locally at `~/.lodis/`:
- `lodis.db` — SQLite database
- `models/` — Cached embedding model (~22MB, downloaded on first search)

No accounts, no cloud, no API keys required for core functionality.

## Development

```bash
pnpm install
pnpm build
pnpm test

# Run MCP server
cd packages/mcp-server && node dist/cli.js

# Run dashboard
cd packages/dashboard && pnpm dev
```

## License

MIT
