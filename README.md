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

## What It Does

- **Remembers across tools.** Teach Claude something, Cursor knows it too.
- **Searches semantically.** Hybrid search (full-text + vector embeddings) finds relevant memories even with different wording.
- **Knows what it knows.** Confidence scoring, source attribution, and entity classification on every memory.
- **Lets you correct it.** Confirm, correct, split, or remove memories through the dashboard or MCP tools.
- **Deduplicates on write.** Similar memories are detected and surfaced to the agent for resolution.
- **Builds a knowledge graph.** Memories connect to each other with typed relationships. Entities (people, organizations, projects) are automatically extracted and linked.

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

## MCP Tools

| Tool | Description |
|------|-------------|
| `memory_search` | Hybrid semantic + keyword search with filters |
| `memory_write` | Store a memory (with dedup detection) |
| `memory_update` | Modify content, detail, or metadata |
| `memory_confirm` | Mark a memory as verified (confidence → 0.99) |
| `memory_correct` | Fix a memory with semantic diff |
| `memory_flag_mistake` | Degrade confidence |
| `memory_remove` | Soft-delete |
| `memory_connect` | Link memories with typed relationships |
| `memory_get_connections` | Traverse the relationship graph |
| `memory_split` | Break compound memories into atomic parts |
| `memory_classify` | Auto-classify memories with entity types |
| `memory_list_entities` | Discover known entities |
| `memory_list` | Browse by domain, type, or confidence |
| `memory_list_domains` | List all domains |
| `memory_set_permissions` | Per-agent access control |
| `memory_scrub` | Detect and redact PII |

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
