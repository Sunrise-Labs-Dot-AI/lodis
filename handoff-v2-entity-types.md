# Handoff: V2 — Entity Types + Knowledge Graph

**Repo:** `Sunrise-Labs-Dot-AI/engrams` (local at `~/Documents/Claude/Projects/engrams`)
**Branch:** `main`
**Budget:** $10
**Timeout:** 25 min

## Context

Engrams stores memories as untyped text blobs. This works for simple fact recall but limits the graph — you can't ask "who do I know at Anthropic?" or "what are my meeting preferences?" without scanning every memory. Adding entity types turns the fact store into a knowledge graph where traversal is type-aware and dedup is entity-aware.

Read `CLAUDE.md` in the repo root for full product context. Key files:

- `packages/core/src/db.ts` — schema, migrations
- `packages/core/src/search.ts` — hybrid search
- `packages/mcp-server/src/server.ts` — MCP tool handlers
- `packages/dashboard/src/lib/db.ts` — dashboard data access
- `packages/dashboard/src/app/memory/[id]/page.tsx` — memory detail page

## What We're Building

### 1. Schema Changes

Add three new columns to the `memories` table:

```sql
ALTER TABLE memories ADD COLUMN entity_type TEXT;
ALTER TABLE memories ADD COLUMN entity_name TEXT;
ALTER TABLE memories ADD COLUMN structured_data TEXT;
```

Add these in the schema initialization block in `packages/core/src/db.ts`. Use `ALTER TABLE` with a try/catch (or check if column exists) so it's safe to run on existing databases.

**`entity_type`** — one of: `person`, `organization`, `place`, `project`, `preference`, `event`, `goal`, `fact`. Nullable — unclassified memories stay null until the extraction pass classifies them.

**`entity_name`** — canonical name for the entity. "Sarah Chen" not "my manager Sarah" or "Sarah from Anthropic". Used for dedup — two memories about the same entity_name + entity_type are likely related or duplicates. Nullable.

**`structured_data`** — JSON string with type-specific fields. Nullable. Schema per type:

```typescript
interface PersonData {
  name: string;
  role?: string;
  organization?: string;
  relationship_to_user?: string;
}

interface OrganizationData {
  name: string;
  type?: string; // company, team, community, etc.
  user_relationship?: string; // works_at, client, partner, etc.
}

interface PlaceData {
  name: string;
  context?: string; // "favorite coffee spot", "office", etc.
}

interface ProjectData {
  name: string;
  status?: string; // active, completed, planned
  user_role?: string;
}

interface PreferenceData {
  category?: string; // meetings, communication, food, schedule, etc.
  strength?: "strong" | "mild" | "contextual";
}

interface EventData {
  what: string;
  when?: string; // ISO date or natural language
  who?: string[];
}

interface GoalData {
  what: string;
  timeline?: string;
  status?: "active" | "achieved" | "abandoned";
}

// FactData has no required fields — it's the catch-all
interface FactData {
  category?: string;
}
```

Add these types to `packages/core/src/types.ts` (create if needed) and export from `packages/core/src/index.ts`.

Add an index for fast type-filtered queries:

```sql
CREATE INDEX IF NOT EXISTS idx_memories_entity_type ON memories(entity_type) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_memories_entity_name ON memories(entity_name) WHERE deleted_at IS NULL;
```

### 2. New Relationship Types

Add these relationship types to the `memory_connections` vocabulary (document in types, no schema change needed since `relationship` is already a free TEXT field):

| Relationship | Meaning | Example |
|-------------|---------|---------|
| `works_at` | Person → Organization | Sarah → Anthropic |
| `involves` | Project/Event → Person | Engrams → James |
| `located_at` | Entity → Place | "Weekly standup" → "Zoom Room 3" |
| `part_of` | Entity → Entity | "Frontend team" → "Anthropic" |
| `about` | Preference/Fact → Entity | "Prefers async" → Sarah |
| `related` | Generic (existing) | Any → Any |
| `supports` | (existing) | Any → Any |
| `contradicts` | (existing) | Any → Any |
| `influences` | (existing) | Any → Any |

### 3. Update `memory_write` MCP Tool

Add optional parameters to the `memory_write` tool schema:

```typescript
{
  name: "memory_write",
  inputSchema: {
    // ... existing params ...
    entity_type: {
      type: "string",
      enum: ["person", "organization", "place", "project", "preference", "event", "goal", "fact"],
      description: "Optional entity classification. If omitted, auto-classification runs in background."
    },
    entity_name: {
      type: "string",
      description: "Canonical name for the entity (e.g. 'Sarah Chen', not 'my manager Sarah'). Helps with dedup."
    },
    structured_data: {
      type: "object",
      description: "Type-specific structured fields. Schema depends on entity_type."
    }
  }
}
```

When `entity_type` is provided by the agent, store it directly. When omitted, queue the memory for background classification (see section 5).

### 4. Entity-Aware Dedup in `memory_write`

Enhance the similarity check (from the dedup injection) to also consider entity matches:

```typescript
// In addition to the hybridSearch similarity check:
if (incoming.entity_name && incoming.entity_type) {
  const entityMatch = sqlite.prepare(
    `SELECT * FROM memories
     WHERE entity_type = ? AND entity_name = ? COLLATE NOCASE
     AND deleted_at IS NULL`
  ).all(incoming.entity_type, incoming.entity_name);

  if (entityMatch.length > 0) {
    // Add to similar_found response — these are strong dedup candidates
    // even if the content text differs
  }
}
```

This catches cases like: existing memory "Sarah Chen is an engineering manager" and new memory "Sarah Chen prefers async communication" — the text is different (low RRF score) but the entity is the same. The agent should know about the existing Sarah Chen memory before creating a new one.

### 5. Background Entity Extraction

Create `packages/core/src/entity-extraction.ts`:

When a memory is written without `entity_type`, run a lightweight Haiku call to classify and extract:

```typescript
import Anthropic from "@anthropic-ai/sdk";

interface ExtractionResult {
  entity_type: string;
  entity_name: string | null;
  structured_data: Record<string, unknown>;
  suggested_connections: {
    target_entity_name: string;
    target_entity_type: string;
    relationship: string;
  }[];
}

export async function extractEntity(
  content: string,
  detail: string | null,
): Promise<ExtractionResult> {
  const client = new Anthropic();
  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 500,
    messages: [{
      role: "user",
      content: `Classify this memory and extract structured data.

Memory: ${content}${detail ? `\nDetail: ${detail}` : ""}

Respond with JSON only:
{
  "entity_type": "person|organization|place|project|preference|event|goal|fact",
  "entity_name": "canonical name or null if not applicable",
  "structured_data": { type-specific fields },
  "suggested_connections": [
    { "target_entity_name": "...", "target_entity_type": "...", "relationship": "works_at|involves|located_at|part_of|about|related" }
  ]
}

Entity type definitions:
- person: about a specific individual
- organization: about a company, team, or group
- place: about a location
- project: about a work project or initiative
- preference: about what the user likes/dislikes/prefers
- event: about something that happened or will happen
- goal: about something the user wants to achieve
- fact: general knowledge that doesn't fit other types

For structured_data, include relevant fields:
- person: name, role, organization, relationship_to_user
- organization: name, type, user_relationship
- place: name, context
- project: name, status, user_role
- preference: category, strength (strong/mild/contextual)
- event: what, when, who
- goal: what, timeline, status (active/achieved/abandoned)
- fact: category`
    }]
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "";
  const cleaned = text.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();
  return JSON.parse(cleaned);
}
```

**When to run extraction:**

In the `memory_write` handler, after inserting the memory, if `entity_type` was not provided:

```typescript
// Fire-and-forget — don't block the write response
extractEntity(content, detail).then(async (result) => {
  sqlite.prepare(
    `UPDATE memories SET entity_type = ?, entity_name = ?, structured_data = ? WHERE id = ?`
  ).run(result.entity_type, result.entity_name, JSON.stringify(result.structured_data), memoryId);

  // Auto-create connections to existing entities
  for (const conn of result.suggested_connections) {
    const target = sqlite.prepare(
      `SELECT id FROM memories
       WHERE entity_name = ? COLLATE NOCASE AND entity_type = ?
       AND deleted_at IS NULL LIMIT 1`
    ).get(conn.target_entity_name, conn.target_entity_type) as { id: string } | undefined;

    if (target) {
      sqlite.prepare(
        `INSERT OR IGNORE INTO memory_connections (source_memory_id, target_memory_id, relationship)
         VALUES (?, ?, ?)`
      ).run(memoryId, target.id, conn.relationship);
    }
  }

  // Bump last_modified
  sqlite.prepare(
    `INSERT OR REPLACE INTO engrams_meta (key, value) VALUES ('last_modified', ?)`
  ).run(new Date().toISOString());
}).catch(() => {
  // Extraction failure is non-fatal — memory is stored, just unclassified
});
```

### 6. Backfill Existing Memories

Add a `memory_classify` MCP tool that classifies untyped memories:

```typescript
{
  name: "memory_classify",
  description: "Classify untyped memories with entity types and extract structured data. Call with no arguments to classify all untyped memories, or pass an ID to classify a specific memory.",
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "string", description: "Optional: classify a specific memory" },
      batch_size: { type: "number", description: "Max memories to classify in one call. Default 20." }
    }
  }
}
```

Handler:

```typescript
// Get unclassified memories
const unclassified = id
  ? [sqlite.prepare(`SELECT * FROM memories WHERE id = ? AND entity_type IS NULL AND deleted_at IS NULL`).get(id)]
  : sqlite.prepare(`SELECT * FROM memories WHERE entity_type IS NULL AND deleted_at IS NULL LIMIT ?`).all(batchSize || 20);

let classified = 0;
let connections_created = 0;

for (const mem of unclassified) {
  try {
    const result = await extractEntity(mem.content, mem.detail);
    sqlite.prepare(
      `UPDATE memories SET entity_type = ?, entity_name = ?, structured_data = ? WHERE id = ?`
    ).run(result.entity_type, result.entity_name, JSON.stringify(result.structured_data), mem.id);
    classified++;

    // Auto-connect (same as write path)
    for (const conn of result.suggested_connections) {
      const target = sqlite.prepare(
        `SELECT id FROM memories WHERE entity_name = ? COLLATE NOCASE AND entity_type = ? AND deleted_at IS NULL LIMIT 1`
      ).get(conn.target_entity_name, conn.target_entity_type);
      if (target) {
        sqlite.prepare(
          `INSERT OR IGNORE INTO memory_connections (source_memory_id, target_memory_id, relationship) VALUES (?, ?, ?)`
        ).run(mem.id, target.id, conn.relationship);
        connections_created++;
      }
    }
  } catch { /* skip failures */ }
}

return textResult({
  classified,
  connections_created,
  remaining: sqlite.prepare(`SELECT COUNT(*) as c FROM memories WHERE entity_type IS NULL AND deleted_at IS NULL`).get().c,
});
```

### 7. Type-Aware Search

In `packages/core/src/search.ts`, add `entity_type` as an optional filter on `hybridSearch`:

```typescript
export async function hybridSearch(
  sqlite: Database.Database,
  query: string,
  options: {
    domain?: string;
    entity_type?: string;  // NEW: filter by entity type
    entity_name?: string;  // NEW: filter by entity name
    minConfidence?: number;
    limit?: number;
    expand?: boolean;
    maxDepth?: number;
    similarityThreshold?: number;
  } = {},
): Promise<ExpandedResult[]>
```

Apply the filter after RRF merge:

```typescript
if (options.entity_type) {
  rankedIds = rankedIds.filter(id => {
    const mem = sqlite.prepare(`SELECT entity_type FROM memories WHERE id = ?`).get(id);
    return mem?.entity_type === options.entity_type;
  });
}
if (options.entity_name) {
  rankedIds = rankedIds.filter(id => {
    const mem = sqlite.prepare(`SELECT entity_name FROM memories WHERE id = ?`).get(id);
    return mem?.entity_name?.toLowerCase() === options.entity_name.toLowerCase();
  });
}
```

Update the `memory_search` MCP tool schema to expose these filters:

```typescript
entity_type: {
  type: "string",
  enum: ["person", "organization", "place", "project", "preference", "event", "goal", "fact"],
  description: "Filter results to a specific entity type"
},
entity_name: {
  type: "string",
  description: "Filter results to a specific entity name (case-insensitive)"
}
```

### 8. Update `memory_list` MCP Tool

Add `entity_type` filter to `memory_list` as well, so agents can browse by type:

```typescript
entity_type: {
  type: "string",
  enum: ["person", "organization", "place", "project", "preference", "event", "goal", "fact"],
  description: "Filter to a specific entity type"
}
```

### 9. Dashboard Updates

**Memory list page (`packages/dashboard/src/app/page.tsx`):**
- Add entity type filter to the MemoryFilters component (dropdown with the 8 types)
- Show entity type badge on memory cards (small pill next to the domain badge)

**Memory detail page (`packages/dashboard/src/app/memory/[id]/page.tsx`):**
- Show entity_type, entity_name, and structured_data in the detail card
- Render structured_data fields as labeled key-value pairs (not raw JSON)
- Add a "Classify" button for untyped memories that triggers extraction

**Dashboard data access (`packages/dashboard/src/lib/db.ts`):**
- Add `entity_type` filter to `getMemories()`
- Add `entity_type`, `entity_name`, `structured_data` to `MemoryRow` interface

### 10. Add `memory_list_entities` MCP Tool

New tool for agents to discover what entities exist:

```typescript
{
  name: "memory_list_entities",
  description: "List known entities grouped by type, with memory counts",
  inputSchema: {
    type: "object",
    properties: {
      entity_type: {
        type: "string",
        enum: ["person", "organization", "place", "project", "preference", "event", "goal", "fact"],
        description: "Filter to a specific type. Omit for all types."
      }
    }
  }
}
```

Handler:

```typescript
const query = entity_type
  ? `SELECT entity_type, entity_name, COUNT(*) as memory_count
     FROM memories WHERE entity_type = ? AND entity_name IS NOT NULL AND deleted_at IS NULL
     GROUP BY entity_type, entity_name ORDER BY memory_count DESC`
  : `SELECT entity_type, entity_name, COUNT(*) as memory_count
     FROM memories WHERE entity_type IS NOT NULL AND entity_name IS NOT NULL AND deleted_at IS NULL
     GROUP BY entity_type, entity_name ORDER BY entity_type, memory_count DESC`;

return textResult({ entities: rows, total: rows.length });
```

## File Changes Summary

| File | Changes |
|------|---------|
| `packages/core/src/db.ts` | Add entity_type, entity_name, structured_data columns + indexes |
| `packages/core/src/types.ts` | New file: entity type definitions, structured data interfaces |
| `packages/core/src/entity-extraction.ts` | New file: Haiku-powered entity classification + extraction |
| `packages/core/src/search.ts` | Add entity_type and entity_name filters to hybridSearch |
| `packages/core/src/index.ts` | Export new types and extraction function |
| `packages/mcp-server/src/server.ts` | Update memory_write (entity params + background extraction), add memory_classify, add memory_list_entities, update memory_search and memory_list with entity filters |
| `packages/dashboard/src/lib/db.ts` | Add entity fields to MemoryRow, entity_type filter to getMemories |
| `packages/dashboard/src/components/memory-filters.tsx` | Add entity type dropdown |
| `packages/dashboard/src/components/memory-card.tsx` | Show entity type badge |
| `packages/dashboard/src/app/memory/[id]/page.tsx` | Show entity details + classify button |

## Verification

```bash
pnpm build && pnpm test
```

Then test:

1. **Agent-provided type:** `memory_write` with entity_type: "person", entity_name: "Sarah Chen" → verify columns stored
2. **Background extraction:** `memory_write` without entity_type → wait 2-3 seconds → query the memory, verify entity_type was populated by Haiku
3. **Auto-connections:** Write "Sarah Chen works at Anthropic" then "Anthropic is an AI safety company" → verify a `works_at` connection was auto-created
4. **Entity dedup:** Write two memories about "Sarah Chen" → second write should return similar_found with entity match
5. **Backfill:** Call `memory_classify` → verify untyped memories get classified
6. **Type-filtered search:** `memory_search` with entity_type: "person" → only person memories returned
7. **Entity listing:** `memory_list_entities` → grouped entity summary
8. **Dashboard:** Entity type badge visible on cards, entity details on detail page, entity type filter works

## Important Notes

- All schema changes are additive (new nullable columns). Fully backward-compatible with existing data.
- Background extraction is fire-and-forget. If the API key isn't configured or Haiku fails, the memory is stored unclassified. The `memory_classify` tool lets users backfill later.
- Entity name matching is case-insensitive (`COLLATE NOCASE`). "Sarah Chen" and "sarah chen" match.
- The structured_data JSON schema is not enforced at the DB level — it's a convention. Type-specific validation happens in the extraction prompt and in the dashboard rendering.
- `memory_list_entities` is a new discovery tool that makes the knowledge graph browsable without search. Agents can call it to understand what entities exist before deciding where to connect new memories.
- Commit and push when complete.
