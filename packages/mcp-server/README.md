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

In your Windsurf MCP config:

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

- **Local-first**: All data stored in `~/.engrams/engrams.db` (SQLite). No accounts, no cloud, no API keys.
- **FTS5 search**: Full-text search across all your memories using SQLite's FTS5 engine.
- **Confidence scoring**: Memories start with confidence based on source type (stated: 90%, observed: 75%, inferred: 65%). Confirmations boost confidence, corrections reset it, mistakes degrade it.
- **Source attribution**: Every memory tracks which agent wrote it and how it was acquired.
- **Audit trail**: All changes are logged in an event timeline.
- **Cross-tool**: Every MCP-compatible tool shares the same memory database.

## Web Dashboard

Engrams includes a web dashboard for browsing and managing your memories visually. Clone the repo to use it:

```bash
git clone https://github.com/Sunrise-Labs-Dot-AI/engrams.git
cd engrams && pnpm install && pnpm build

# Start the MCP server with HTTP API
node packages/mcp-server/dist/cli.js --http

# In another terminal, start the dashboard
cd packages/dashboard && pnpm dev
```

Open `http://localhost:3000` to browse memories, search, confirm, correct, and manage agent permissions.

## Contributing

Contributions welcome! Please open an issue or pull request on [GitHub](https://github.com/Sunrise-Labs-Dot-AI/engrams).

## License

MIT
