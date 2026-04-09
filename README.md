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

### Dashboard LLM features

For LLM-powered correction, splitting, and entity extraction, set your Anthropic API key:

```bash
echo "ANTHROPIC_API_KEY=sk-ant-..." > packages/dashboard/.env.local
```

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
