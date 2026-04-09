# Handoff: V2 Final — Confidence Decay, Graph Viz Fix, Tests, README

**Repo:** `Sunrise-Labs-Dot-AI/engrams` (local at `~/Documents/Claude/Projects/engrams`)
**Branch:** `main`
**Budget:** $12
**Timeout:** 30 min

## Context

V2 feature work is largely done. This handoff covers the remaining scope: confidence decay, fixing the graph visualization, expanding test coverage, and writing the README for npm publish readiness.

Read `CLAUDE.md` in the repo root for full product context.

**Current state:**
- 4 existing test files: `db.test.ts`, `confidence.test.ts`, `pii.test.ts`, `write-dedup.test.ts` (all in `packages/core/src/__tests__/`)
- No README exists
- CLI entry point exists at `packages/mcp-server/src/cli.ts`, `bin` configured in package.json
- Graph visualization exists but the UI is poor — force-directed layout is cluttered and unusable
- No confidence decay implemented yet

## Part 1: Confidence Decay

Add time-based confidence decay so unused/unconfirmed memories naturally lose relevance.

### Implementation

In `packages/core/src/db.ts` (or wherever confidence updates happen), add a function:

```typescript
export function applyConfidenceDecay(sqlite: Database.Database): number {
  const DECAY_RATE = 0.01; // per 30 days
  const MIN_CONFIDENCE = 0.10;
  const DECAY_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

  const now = new Date();

  // Get all non-deleted memories that haven't been used or confirmed in 30+ days
  const candidates = sqlite.prepare(`
    SELECT id, confidence, last_used_at, confirmed_at, learned_at
    FROM memories
    WHERE deleted_at IS NULL AND confidence > ?
  `).all(MIN_CONFIDENCE) as {
    id: string;
    confidence: number;
    last_used_at: string | null;
    confirmed_at: string | null;
    learned_at: string | null;
  }[];

  let decayed = 0;

  for (const mem of candidates) {
    // Use the most recent activity timestamp
    const lastActivity = mem.last_used_at || mem.confirmed_at || mem.learned_at;
    if (!lastActivity) continue;

    const elapsed = now.getTime() - new Date(lastActivity).getTime();
    const periods = Math.floor(elapsed / DECAY_INTERVAL_MS);

    if (periods <= 0) continue;

    const newConfidence = Math.max(mem.confidence - (DECAY_RATE * periods), MIN_CONFIDENCE);
    if (newConfidence < mem.confidence) {
      sqlite.prepare(
        `UPDATE memories SET confidence = ? WHERE id = ?`
      ).run(newConfidence, mem.id);
      decayed++;
    }
  }

  return decayed;
}
```

### When to run decay

Call `applyConfidenceDecay` lazily — on `memory_search` and `memory_list` calls, but throttled to once per hour max:

```typescript
let lastDecayRun = 0;
const DECAY_THROTTLE_MS = 60 * 60 * 1000; // 1 hour

function maybeRunDecay(sqlite: Database.Database) {
  const now = Date.now();
  if (now - lastDecayRun > DECAY_THROTTLE_MS) {
    applyConfidenceDecay(sqlite);
    lastDecayRun = now;
  }
}
```

Add `maybeRunDecay(sqlite)` at the top of the `memory_search` and `memory_list` handlers in `packages/mcp-server/src/server.ts`.

### Test

Add to `packages/core/src/__tests__/confidence.test.ts`:
- Memory with `last_used_at` 60 days ago gets 2x decay applied
- Memory with `confirmed_at` 15 days ago gets no decay
- Memory at MIN_CONFIDENCE doesn't go below it
- Decay runs at most once per hour (throttle)

## Part 2: Fix Graph Visualization

The current D3 force-directed graph is cluttered and unusable. Replace it with a cleaner approach.

### New Design: Entity-Centric Cluster Layout

Instead of showing every memory as a node, aggregate by entity:

**Primary view: Entity clusters**
- Each unique `entity_name` (where not null) becomes a node
- Node size = number of memories with that entity_name
- Node color = entity_type (same color map as before)
- Edges between entities based on `memory_connections` between their memories
- Edge thickness = number of connections between the two entities
- This dramatically reduces node count (entities, not individual memories)

**Fallback for unclustered memories:**
- Memories without entity_name show as small individual nodes
- Grouped in a "Uncategorized" cluster at the periphery

**Interaction:**
- Click an entity node → expand to show its individual memories as child nodes in a radial layout around it
- Click again to collapse
- Hover shows: entity name, type, memory count, top 3 memory summaries
- Click a child memory node → navigate to `/memory/[id]`

### Data changes

Add to `packages/dashboard/src/lib/db.ts`:

```typescript
export interface EntityNode {
  entityName: string;
  entityType: string;
  memoryCount: number;
  avgConfidence: number;
  memoryIds: string[];
}

export interface EntityEdge {
  sourceEntity: string;
  targetEntity: string;
  connectionCount: number;
  relationships: string[]; // unique relationship types
}

export function getEntityGraphData(): {
  entities: EntityNode[];
  edges: EntityEdge[];
  uncategorized: GraphNode[];
} {
  const db = getReadDb();

  const entities = db.prepare(`
    SELECT entity_name as entityName, entity_type as entityType,
           COUNT(*) as memoryCount, AVG(confidence) as avgConfidence,
           GROUP_CONCAT(id) as memoryIdsCsv
    FROM memories
    WHERE deleted_at IS NULL AND entity_name IS NOT NULL
    GROUP BY entity_name, entity_type
    ORDER BY memoryCount DESC
  `).all() as (EntityNode & { memoryIdsCsv: string })[];

  // Parse CSV ids into arrays
  const entityNodes = entities.map(e => ({
    ...e,
    memoryIds: e.memoryIdsCsv.split(','),
  }));

  // Edges: connections between memories of different entities
  const edges = db.prepare(`
    SELECT
      m1.entity_name as sourceEntity,
      m2.entity_name as targetEntity,
      COUNT(*) as connectionCount,
      GROUP_CONCAT(DISTINCT mc.relationship) as relationshipsCsv
    FROM memory_connections mc
    JOIN memories m1 ON m1.id = mc.source_memory_id AND m1.deleted_at IS NULL
    JOIN memories m2 ON m2.id = mc.target_memory_id AND m2.deleted_at IS NULL
    WHERE m1.entity_name IS NOT NULL AND m2.entity_name IS NOT NULL
      AND m1.entity_name != m2.entity_name
    GROUP BY m1.entity_name, m2.entity_name
  `).all() as (EntityEdge & { relationshipsCsv: string })[];

  const entityEdges = edges.map(e => ({
    ...e,
    relationships: e.relationshipsCsv.split(','),
  }));

  // Uncategorized: memories without entity_name
  const uncategorized = db.prepare(`
    SELECT id, content, entity_type, entity_name, domain, confidence, 0 as connectionCount
    FROM memories WHERE deleted_at IS NULL AND entity_name IS NULL
    ORDER BY confidence DESC LIMIT 30
  `).all() as GraphNode[];

  return { entities: entityNodes, edges: entityEdges, uncategorized };
}
```

### Component rewrite

Rewrite `packages/dashboard/src/components/knowledge-graph.tsx`:

- Use the entity-centric data from `getEntityGraphData()`
- Force simulation with far fewer nodes (entities, not memories)
- Much cleaner default layout
- Keep the same color map, controls panel, and legend
- Add click-to-expand interaction for entity nodes
- Keep the 200-node cap but it should rarely hit since we're aggregating

Update `packages/dashboard/src/app/graph/page.tsx` to call `getEntityGraphData()` instead of `getGraphData()`.

**Keep `getGraphData()` around** — it may be useful elsewhere. Just don't use it for the graph page anymore.

### Empty state improvement

If there are no entities yet (all entity_type/entity_name are null):
- Show a clean card: "Memories need entity classification before the graph can render. Run `memory_classify` to get started."
- Below that, show a simple stat card: "X memories · Y connections · Z domains"

## Part 3: Test Coverage

Add tests for the features that shipped without them. All tests go in `packages/core/src/__tests__/`.

### `search.test.ts` (new)
- hybridSearch returns results ranked by RRF
- Confidence weighting affects result order
- Recency boost gives recent memories higher scores
- Entity type filter works
- Entity name filter works (case-insensitive)
- Graph expansion follows connections up to maxDepth
- Graph expansion stops at similarityThreshold
- Result cache returns cached results when no writes occurred
- Result cache invalidates after a write
- Embedding cache returns cached embedding within TTL
- Empty query returns empty results

### `entity-extraction.test.ts` (new)
- Correctly classifies a person memory
- Correctly classifies a preference memory
- Extracts entity_name from content
- Handles API failure gracefully (returns null/default)
- Passes existing entity names to prompt for normalization

Note: These tests will need to mock the Anthropic API. Use vitest mocks:
```typescript
vi.mock("@anthropic-ai/sdk", () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: "text", text: JSON.stringify({ entity_type: "person", entity_name: "Test User", structured_data: {}, suggested_connections: [] }) }]
      })
    }
  }))
}));
```

### `decay.test.ts` (new)
- Confidence decays after 30 days of inactivity
- No decay within 30 days
- Decay doesn't go below MIN_CONFIDENCE
- Multiple periods of inactivity compound correctly
- Used memories don't decay (last_used_at is recent)
- Confirmed memories don't decay (confirmed_at is recent)

### Run all tests

```bash
cd packages/core && pnpm test
```

Fix any failures before proceeding.

## Part 4: README

Create `README.md` in the repo root. This is the face of the product on GitHub and npm.

### Structure

```markdown
# Engrams

Universal, portable memory layer for AI agents.

Engrams gives your AI tools a shared memory — searchable, correctable, and under your control. Install once, connect to Claude Code, Cursor, Windsurf, or any MCP-compatible client.

## Quick Start

Add to your Claude Code config (`~/.claude.json`):

\```json
{
  "mcpServers": {
    "engrams": {
      "command": "npx",
      "args": ["-y", "engrams"]
    }
  }
}
\```

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

\```bash
cd packages/dashboard && pnpm dev
\```

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
\```json
{
  "mcpServers": {
    "engrams": {
      "command": "npx",
      "args": ["-y", "engrams"]
    }
  }
}
\```

**Cursor** (`.cursor/mcp.json`):
\```json
{
  "mcpServers": {
    "engrams": {
      "command": "npx",
      "args": ["-y", "engrams"]
    }
  }
}
\```

**Windsurf** (`~/.windsurf/mcp.json`):
\```json
{
  "mcpServers": {
    "engrams": {
      "command": "npx",
      "args": ["-y", "engrams"]
    }
  }
}
\```

### Dashboard LLM features

For LLM-powered correction, splitting, and entity extraction, set your Anthropic API key:

\```bash
echo "ANTHROPIC_API_KEY=sk-ant-..." > packages/dashboard/.env.local
\```

## Data

All data lives locally at `~/.engrams/`:
- `engrams.db` — SQLite database
- `models/` — Cached embedding model (~22MB, downloaded on first search)

No accounts, no cloud, no API keys required for core functionality.

## Development

\```bash
pnpm install
pnpm build
pnpm test

# Run MCP server
cd packages/mcp-server && node dist/cli.js

# Run dashboard
cd packages/dashboard && pnpm dev
\```

## License

MIT
```

### Important notes for the README
- Escape the backtick code fences properly (triple backtick blocks inside markdown)
- Don't include screenshots (we don't have any to reference)
- Keep it scannable — someone should understand what this does in 30 seconds
- The JSON config snippets are the most important part — they need to be copy-pasteable

## Verification

```bash
pnpm build && pnpm test
```

Then:
1. Verify confidence decay: manually set a memory's `last_used_at` to 60 days ago, run `memory_search`, check that its confidence decreased
2. Verify graph page loads and renders entity clusters (restart dashboard dev server after changes)
3. Verify all new tests pass
4. Verify README renders correctly: `cat README.md` and eyeball it

Commit and push when complete.
