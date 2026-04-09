# Engrams

[![npm version](https://img.shields.io/npm/v/engrams.svg)](https://www.npmjs.com/package/engrams)
[![license](https://img.shields.io/npm/l/engrams.svg)](https://github.com/Sunrise-Labs-Dot-AI/engrams/blob/main/LICENSE)

**Universal, portable memory layer for AI agents.**

Engrams gives your AI tools persistent, cross-tool memory backed by local SQLite. Any MCP-compatible tool — Claude Code, Cursor, Windsurf, Claude Desktop, Cline — connects to the same memory. Your agents remember what you tell them, learn from corrections, and build confidence over time.

## Quick Start

Add to your MCP config and you're done:

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

That's it. Your AI agent now has persistent memory.

## Getting Started

After installing, tell your AI assistant:

> "Help me set up Engrams"

The assistant will scan your connected tools (calendar, email, GitHub), ask a few targeted questions, and seed 30-50 memories with entity types and connections. Review at `localhost:3838`.

### Importing Existing Memories

- **Claude Code auto-memory:** "Import my Claude memories into Engrams"
- **ChatGPT memory export:** "Import this ChatGPT memory export into Engrams"
- **Cursor rules:** "Import my .cursorrules as Engrams preferences"

## What You Get

Engrams provides 20 MCP tools:

| Tool | Description |
|------|-------------|
| `memory_write` | Create a new memory with dedup detection and resolution |
| `memory_search` | Full-text search across all memories (FTS5) |
| `memory_update` | Modify a memory's content, detail, or domain |
| `memory_remove` | Soft-delete a memory |
| `memory_confirm` | Confirm a memory is correct (boosts confidence) |
| `memory_correct` | Replace content and reset confidence |
| `memory_flag_mistake` | Flag a memory as incorrect (degrades confidence) |
| `memory_connect` | Create typed relationships between memories |
| `memory_get_connections` | View a memory's relationship graph |
| `memory_split` | Break compound memories into atomic units |
| `memory_scrub` | Detect and redact PII or secrets from memory content |
| `memory_list` | Browse memories by domain, sorted by confidence or recency |
| `memory_list_domains` | List all memory domains with counts |
| `memory_list_entities` | List extracted entities grouped by type |
| `memory_classify` | Batch-classify untyped memories using entity extraction |
| `memory_set_permissions` | Configure per-agent read/write access |
| `memory_configure` | Configure LLM provider for entity extraction and corrections |
| `memory_onboard` | Get a personalized onboarding plan to seed your memory |
| `memory_import` | Import from Claude, ChatGPT, Cursor, gitconfig, or plaintext |
| `memory_sync` | Sync memories with cloud (Pro tier) |

### Key features

- **Hybrid search** — FTS5 full-text + vector embeddings (all-MiniLM-L6-v2, local) merged via Reciprocal Rank Fusion
- **Entity types** — Memories auto-classified as person, organization, place, project, preference, event, goal, or fact
- **Knowledge graph** — Typed relationships between memories, auto-connected entities
- **Confidence scoring** — 0-1 scale based on confirmations, corrections, mistakes, usage, and time decay
- **Dedup on write** — Similar memories detected and surfaced to the agent for resolution
- **PII detection** — Regex-based pattern detection with `memory_scrub` for redaction
- **Source attribution** — Every memory tracks which agent learned it and how

## MCP Config Examples

### Claude Code

In `~/.claude.json` or your project's `.mcp.json`:

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

### Claude Desktop

In `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

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

### Cursor

In `.cursor/mcp.json` in your project root:

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

### Windsurf

In `~/.windsurf/mcp.json`:

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

## How It Works

- **Local-first**: All data stored in `~/.engrams/engrams.db` (SQLite). No accounts, no cloud, no API keys for core functionality.
- **Hybrid search**: FTS5 keyword search + sqlite-vec vector embeddings, merged with Reciprocal Rank Fusion (k=60). Confidence-weighted scoring and recency boost.
- **Embeddings**: all-MiniLM-L6-v2 via Transformers.js — runs locally, no API calls, no cost. ~22MB model cached on first search.
- **Confidence scoring**: Memories start with confidence based on source type (stated: 90%, observed: 75%, inferred: 65%). Confirmations boost to 99%, corrections reset, mistakes degrade. Unused memories decay over time.
- **Entity extraction**: Memories auto-classified into 8 entity types with structured data. Connections auto-created between related entities.
- **Source attribution**: Every memory tracks which agent wrote it and how it was acquired.
- **Audit trail**: All changes logged in an event timeline.
- **Cross-tool**: Every MCP-compatible tool shares the same memory database.

## LLM Provider (optional)

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

Or configure via `~/.engrams/config.json` for per-task model routing. No LLM? Core features (search, store, connect) work without one.

## Web Dashboard

Engrams includes a web dashboard for browsing and managing your memories visually. Clone the repo to use it:

```bash
git clone https://github.com/Sunrise-Labs-Dot-AI/engrams.git
cd engrams && pnpm install && pnpm build

# Start the dashboard
cd packages/dashboard && pnpm dev
```

Open [localhost:3838](http://localhost:3838) to browse memories, search, confirm, correct, manage agent permissions, explore the knowledge graph, and run cleanup operations.

## Contributing

Contributions welcome! Please open an issue or pull request on [GitHub](https://github.com/Sunrise-Labs-Dot-AI/engrams).

## License

MIT
