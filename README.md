# Engrams

Universal, portable memory layer for AI agents.

Engrams gives your AI tools a shared memory — searchable, correctable, and under your control. Install once, connect to Claude Code, Cursor, Windsurf, or any MCP-compatible client.

## Quick Start

Add to your Claude Code config (`~/.claude.json`):

```json
{
  "mcpServers": {
    "engrams": {
      "command": "npx",
      "args": ["-y", "engrams"]
    }
  }
}
```

That's it. Your AI now has persistent memory.

## Getting Started

After installing, tell your AI assistant:

> "Help me set up Engrams"

The assistant will call `memory_onboard` and:
1. **Scan** your connected tools (calendar, email, GitHub) to extract people, projects, and context
2. **Interview** you with targeted questions based on what it found
3. **Seed** 30-50 memories with entity types and connections

Review your memories at `localhost:3838`. Confirm what's right, correct what's wrong.

### Importing Existing Memories

If you have memories in other tools, your AI can import them:

- **Claude Code auto-memory:** "Import my Claude memories into Engrams"
- **ChatGPT memory export:** "Import this ChatGPT memory export into Engrams"
- **Cursor rules:** "Import my .cursorrules as Engrams preferences"

The `memory_import` tool handles parsing, deduplication, and entity classification automatically.

## What It Does

- **Remembers across tools.** Teach Claude something, Cursor knows it too.
- **Searches semantically.** Hybrid search (full-text + vector embeddings) finds relevant memories even with different wording.
- **Knows what it knows.** Confidence scoring, source attribution, and entity classification on every memory.
- **Lets you correct it.** Confirm, correct, split, or remove memories through the dashboard or MCP tools.
- **Deduplicates on write.** Similar memories are detected and surfaced to the agent for resolution.
- **Builds a knowledge graph.** Memories connect to each other with typed relationships. 13 entity types (people, organizations, projects, preferences, and more) are automatically extracted and linked.
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
- LLM-powered correction and splitting (requires `ANTHROPIC_API_KEY`)
- Knowledge graph visualization
- Cleanup page for deduplication and maintenance
- Archive page for browsing archived memories with restore actions
- Entity profile pages with LLM-generated summaries
- Settings page with LLM provider configuration

## MCP Tools

| Tool | Description |
|------|-------------|
| `memory_search` | Hybrid semantic + keyword search with filters |
| `memory_context` | Token-budget-aware context retrieval |
| `memory_briefing` | LLM-generated entity profile summaries |
| `memory_write` | Store a memory (with dedup detection and permanence tiers) |
| `memory_update` | Modify content, detail, or metadata |
| `memory_confirm` | Mark a memory as verified (confidence → 0.99) |
| `memory_correct` | LLM-powered semantic diff correction |
| `memory_flag_mistake` | Degrade confidence |
| `memory_remove` | Soft-delete |
| `memory_pin` | Pin as canonical (decay-immune, high confidence) |
| `memory_archive` | Archive for reference (deprioritize, freeze confidence) |
| `memory_connect` | Link memories with typed relationships |
| `memory_get_connections` | Traverse the relationship graph |
| `memory_split` | Break compound memories into atomic parts |
| `memory_classify` | Auto-classify memories with entity types |
| `memory_list_entities` | Discover known entities |
| `memory_list` | Browse by domain, type, or confidence |
| `memory_list_domains` | List all domains |
| `memory_set_permissions` | Per-agent access control |
| `memory_scrub` | Detect and redact PII |
| `memory_onboard` | Guided onboarding: scan tools, interview, seed memories |
| `memory_interview` | Agent-driven cleanup and gap-fill |
| `memory_import` | Batch import from Claude, ChatGPT, Cursor, gitconfig |
| `memory_export` | Export memories as portable JSON |
| `memory_index` | Index external docs (Drive, Notion, filesystem) |
| `memory_index_status` | Check staleness of indexed documents |
| `memory_migrate` | Migrate local memories to cloud (Pro tier) |

## Architecture

- **Storage:** SQLite via better-sqlite3, local at `~/.engrams/engrams.db`
- **Search:** FTS5 + sqlite-vec + Reciprocal Rank Fusion
- **Embeddings:** all-MiniLM-L6-v2 via Transformers.js (local, no API calls)
- **Entity extraction:** Claude Sonnet (requires API key, optional)
- **Dashboard:** Next.js 15, Tailwind v4
- **Transport:** MCP stdio protocol

## Configuration

### Client configs

**Claude Desktop** (`~/Library/Application Support/Claude/claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "engrams": {
      "command": "npx",
      "args": ["-y", "engrams"]
    }
  }
}
```

**Cursor** (`.cursor/mcp.json`):
```json
{
  "mcpServers": {
    "engrams": {
      "command": "npx",
      "args": ["-y", "engrams"]
    }
  }
}
```

**Windsurf** (`~/.windsurf/mcp.json`):
```json
{
  "mcpServers": {
    "engrams": {
      "command": "npx",
      "args": ["-y", "engrams"]
    }
  }
}
```

### LLM Provider (optional)

Entity extraction, correction, and splitting use an LLM. Bring your own API key:

**Anthropic (auto-detected)**
```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

**OpenAI**
```bash
export OPENAI_API_KEY=sk-...
export ENGRAMS_LLM_PROVIDER=openai
```

**Ollama (local, free)**
```bash
ollama pull llama3.2
export ENGRAMS_LLM_PROVIDER=ollama
```

**Custom OpenAI-compatible endpoint**
```bash
export ENGRAMS_LLM_PROVIDER=openai
export ENGRAMS_LLM_MODEL=mixtral-8x7b
export ENGRAMS_LLM_BASE_URL=https://api.together.xyz/v1
export ENGRAMS_API_KEY=...
```

Or configure via `~/.engrams/config.json`:
```json
{
  "llm": {
    "provider": "anthropic",
    "apiKey": "sk-ant-...",
    "models": {
      "extraction": "claude-haiku-4-5-20251001",
      "analysis": "claude-sonnet-4-5-20250514"
    }
  }
}
```

Engrams uses two model tiers:
- **Extraction** (runs on every write): entity classification, proactive split detection. A fast, cheap model is fine.
- **Analysis** (user-initiated): correction, splitting, cleanup. Use a capable model for quality results.

No LLM? No problem. Core features (search, store, connect, sync) work without one.

## Data

All data lives locally at `~/.engrams/`:
- `engrams.db` — SQLite database
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
