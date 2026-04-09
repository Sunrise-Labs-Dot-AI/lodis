# Handoff: Memory Onboarding — Scan, Interview, Review

**Repo:** `Sunrise-Labs-Dot-AI/engrams` (local at `~/Documents/Claude/Projects/engrams`)
**Branch:** `main`
**Budget:** $15
**Timeout:** 30 min

## Context

Engrams has a cold start problem. New users install the MCP server and have zero memories — the product feels empty. Meanwhile, they likely have rich context scattered across connected tools (calendar, email, GitHub) and existing files (CLAUDE.md, .cursorrules, .gitconfig).

This handoff adds a `memory_onboard` MCP tool that orchestrates a three-phase onboarding: silent tool scan → informed interview → review prompt. The key insight is that Engrams can't call other MCP tools directly — the *agent* is the orchestrator. So `memory_onboard` returns a structured action plan that the agent executes using whatever tools it has available.

Read `CLAUDE.md` in the repo root for full project context.

**Existing code you'll be working with:**
- `packages/mcp-server/src/server.ts` — MCP server with all tool handlers
- `packages/core/src/db.ts` — `createDatabase()` returns `{ db, sqlite, vecAvailable }`
- `packages/core/src/schema.ts` — Drizzle schema (memories, memory_connections, memory_events)
- `packages/core/src/types.ts` — TypeScript types including `EntityType`
- `packages/dashboard/src/app/page.tsx` — main dashboard page (will need empty state)
- `packages/dashboard/src/components/` — existing UI components (Card, Button, StatusBadge, etc.)

## Part 1: `memory_onboard` MCP Tool

Add to `packages/mcp-server/src/server.ts`:

### Tool definition

```typescript
{
  name: "memory_onboard",
  description: "Get a personalized onboarding plan to seed your memory database. Returns a structured action plan based on your current memory state. Call this when the user is new or asks to set up their memory. The plan tells you which connected tools to scan and what interview questions to ask — execute each step using the tools available to you.",
  inputSchema: {
    type: "object",
    properties: {
      available_tools: {
        type: "array",
        items: { type: "string" },
        description: "List of MCP tool names you have access to (e.g. ['gcal_list_events', 'gmail_search_messages', 'github_list_repos']). This helps generate a targeted plan."
      },
      skip_scan: {
        type: "boolean",
        description: "Skip the tool scan phase and go straight to interview. Default false."
      },
      skip_interview: {
        type: "boolean",
        description: "Skip the interview phase. Useful if re-running just the scan. Default false."
      }
    },
    required: []
  }
}
```

### Handler logic

The handler does three things:
1. Checks current DB state (memory count, entity counts, what entity types exist)
2. Analyzes available tools to determine which scan phases are possible
3. Returns a structured action plan as text

```typescript
case "memory_onboard": {
  // 1. Assess current state
  const memoryCount = sqlite.prepare("SELECT COUNT(*) as count FROM memories WHERE deleted_at IS NULL").get() as { count: number };
  const entityCounts = sqlite.prepare(`
    SELECT entity_type, COUNT(*) as count 
    FROM memories 
    WHERE entity_type IS NOT NULL AND deleted_at IS NULL 
    GROUP BY entity_type
  `).all() as { entity_type: string; count: number }[];
  const domainCounts = sqlite.prepare(`
    SELECT domain, COUNT(*) as count 
    FROM memories 
    WHERE deleted_at IS NULL 
    GROUP BY domain
  `).all() as { domain: string; count: number }[];

  const totalMemories = memoryCount.count;
  const entityMap = Object.fromEntries(entityCounts.map(e => [e.entity_type, e.count]));
  const domainMap = Object.fromEntries(domainCounts.map(d => [d.domain, d.count]));

  // 2. Categorize available tools
  const tools = (args.available_tools as string[] | undefined) || [];
  const hasCalendar = tools.some(t => /gcal|calendar|cal_list|list_events/i.test(t));
  const hasEmail = tools.some(t => /gmail|email|mail|search_messages/i.test(t));
  const hasGitHub = tools.some(t => /github|gh_|list_repos|list_prs/i.test(t));
  const hasSlack = tools.some(t => /slack|channel|send_message/i.test(t));
  const hasNotes = tools.some(t => /note|notion|obsidian/i.test(t));
  const hasFiles = tools.some(t => /read_file|file_read|cat|Read/i.test(t));

  // 3. Build the plan
  const plan: string[] = [];

  // Header with current state
  if (totalMemories === 0) {
    plan.push("# Onboarding Plan — Fresh Start");
    plan.push("");
    plan.push("Your memory database is empty. Let's fix that. This plan will seed your memories from connected tools and a short conversation.");
  } else if (totalMemories < 20) {
    plan.push("# Onboarding Plan — Early Stage");
    plan.push("");
    plan.push(`You have ${totalMemories} memories so far. Let's enrich your knowledge graph with more context from your tools.`);
  } else {
    plan.push("# Onboarding Plan — Enrichment");
    plan.push("");
    plan.push(`You have ${totalMemories} memories across ${Object.keys(domainMap).length} domains. Here's what could be filled in.`);
    if (entityCounts.length > 0) {
      plan.push("");
      plan.push("Current entity coverage:");
      for (const e of entityCounts) {
        plan.push(`- ${e.entity_type}: ${e.count}`);
      }
    }
    // Identify gaps
    const allTypes = ["person", "organization", "place", "project", "preference", "event", "goal"];
    const missing = allTypes.filter(t => !entityMap[t]);
    if (missing.length > 0) {
      plan.push("");
      plan.push(`Missing entity types: ${missing.join(", ")}. The scan and interview below will help fill these gaps.`);
    }
  }

  // Phase 1: Tool scan
  if (!args.skip_scan) {
    plan.push("");
    plan.push("---");
    plan.push("");
    plan.push("## Phase 1: Silent Scan");
    plan.push("");
    plan.push("Scan the user's connected tools to extract people, projects, events, and context. Do this BEFORE the interview — the interview will be much better with this context.");
    plan.push("");
    plan.push("**Important:** For each piece of information you extract, call `memory_write` with appropriate `domain`, `source_type: \"inferred\"`, and `source_description` noting which tool it came from. The system will automatically classify entities and create connections.");
    plan.push("");
    plan.push("**Dedup:** Before writing, call `memory_search` with the key terms to check if a similar memory already exists. If it does, skip or use `memory_update` to enrich it.");

    if (hasCalendar) {
      plan.push("");
      plan.push("### Calendar (available)");
      plan.push("");
      plan.push("1. Fetch events from the past 30 days");
      plan.push("2. Identify **recurring meetings** — these reveal team structure, projects, and key relationships");
      plan.push("   - For each recurring meeting: write a memory about what it is, who attends, and its cadence");
      plan.push("   - Extract each unique attendee as a person memory (name, how they relate to the user)");
      plan.push("3. Identify **project-related events** — standups, retros, planning sessions reveal active projects");
      plan.push("   - Write a memory for each distinct project you can identify");
      plan.push("4. Look for **1:1 meetings** — these are the user's closest collaborators");
      plan.push("5. Note any upcoming events in the next 7 days that suggest deadlines or goals");
      plan.push("");
      plan.push("Expected yield: 15-30 memories (people, projects, events, organizations)");
    }

    if (hasEmail) {
      plan.push("");
      plan.push("### Email (available)");
      plan.push("");
      plan.push("1. Search recent emails (past 14 days) for threads with the most back-and-forth — these are active topics");
      plan.push("2. Identify **key contacts** — people the user emails most frequently");
      plan.push("   - Cross-reference with calendar attendees to enrich existing person memories");
      plan.push("3. Look for **commitments and action items** — 'I'll send this by Friday', 'Let's schedule...', 'Following up on...'");
      plan.push("   - Write as event or goal memories");
      plan.push("4. Identify **external organizations** — clients, vendors, partners mentioned in email");
      plan.push("5. **DO NOT** read email body content in detail. Scan subjects, senders, and thread summaries only. Respect privacy.");
      plan.push("");
      plan.push("Expected yield: 10-20 memories (people, organizations, goals, events)");
    }

    if (hasGitHub) {
      plan.push("");
      plan.push("### GitHub (available)");
      plan.push("");
      plan.push("1. List the user's recent repositories (past 90 days of activity)");
      plan.push("2. For each active repo: write a project memory with the repo name, language/stack, and the user's role");
      plan.push("3. Check recent PRs for **collaborators** — frequent reviewers and co-authors are key people");
      plan.push("4. Note the **tech stack** across repos — languages, frameworks, tools. Write as preference/fact memories");
      plan.push("5. Look for any README descriptions that explain what projects do");
      plan.push("");
      plan.push("Expected yield: 10-20 memories (projects, people, preferences, facts)");
    }

    if (hasSlack) {
      plan.push("");
      plan.push("### Slack/Messaging (available)");
      plan.push("");
      plan.push("1. List channels the user is active in — channel names often map to projects or teams");
      plan.push("2. Identify **DM contacts** — frequent DM partners are close collaborators");
      plan.push("3. Note channel topics/descriptions for project context");
      plan.push("4. **DO NOT** read message history in detail. Use channel metadata only.");
      plan.push("");
      plan.push("Expected yield: 5-15 memories (projects, people, organizations)");
    }

    if (hasNotes) {
      plan.push("");
      plan.push("### Notes/Docs (available)");
      plan.push("");
      plan.push("1. Search for recent documents the user has edited");
      plan.push("2. Document titles and summaries reveal active projects and interests");
      plan.push("3. Look for any documents that look like personal notes, goals, or planning docs");
      plan.push("");
      plan.push("Expected yield: 5-10 memories (projects, goals, facts)");
    }

    // File-based sources (always available if the agent can read files)
    plan.push("");
    plan.push("### Local Files (always available)");
    plan.push("");
    plan.push("Check for and read these files if they exist:");
    plan.push("");
    plan.push("- `~/.gitconfig` — user's name, email, identity. Write as a person memory about the user.");
    plan.push("- `~/.claude/CLAUDE.md` or any `CLAUDE.md` in the working directory — existing instructions and preferences. Each instruction is a preference memory.");
    plan.push("- `~/.claude/memory/` or `~/.claude/projects/*/memory/` — Claude Code auto-memory files. Parse each line/section as a separate memory. These are high-quality since the user or their AI already curated them.");
    plan.push("- `.cursorrules` or `.windsurfrules` in the working directory — coding preferences. Each rule is a preference memory.");
    plan.push("- `~/.config/` — scan for tool configs that reveal preferences (editor settings, shell aliases, etc.). Be selective — only extract meaningful preferences, not every config line.");
    plan.push("");
    plan.push("Expected yield: 5-15 memories (preferences, person, facts)");

    if (!hasCalendar && !hasEmail && !hasGitHub && !hasSlack && !hasNotes) {
      plan.push("");
      plan.push("### No connected tools detected");
      plan.push("");
      plan.push("You didn't list any calendar, email, GitHub, or notes tools. That's fine — the Local Files scan and the interview will still seed a solid foundation. If you do have connected tools, call `memory_onboard` again with `available_tools` listing your tool names for a richer scan.");
    }
  }

  // Phase 2: Informed interview
  if (!args.skip_interview) {
    plan.push("");
    plan.push("---");
    plan.push("");
    plan.push("## Phase 2: Informed Interview");
    plan.push("");
    plan.push("After the scan, you have a base of extracted context. Now have a SHORT conversation with the user to fill in meaning, relationships, and preferences that tools can't surface.");
    plan.push("");
    plan.push("**Rules:**");
    plan.push("- Reference what you learned in the scan. Don't ask questions you already have answers to.");
    plan.push("- Ask ONE question at a time. Wait for the answer before the next question.");
    plan.push("- Write memories immediately after each answer — don't batch them.");
    plan.push("- 5-7 questions max. Respect the user's time.");
    plan.push("- Tailor questions to what's MISSING, not what you already know.");
    plan.push("");

    if (totalMemories > 0 || !args.skip_scan) {
      plan.push("### Suggested questions (adapt based on what the scan found):");
      plan.push("");
      plan.push("1. **Confirm and enrich key relationships:** \"I found [names] across your calendar/email. Who are the most important people in your day-to-day — your direct team, your manager, key stakeholders?\"");
      plan.push("   → Write person memories with relationship_to_user and connect them to projects/orgs");
      plan.push("");
      plan.push("2. **Clarify project priorities:** \"I see you're involved in [projects]. What's your main focus right now? Are any of these winding down or just starting?\"");
      plan.push("   → Update project memories with status, write goal memories for priorities");
      plan.push("");
      plan.push("3. **Organizational context:** \"What does [organization] do? What's your role there?\"");
      plan.push("   → Write/enrich organization and person memories");
      plan.push("");
      plan.push("4. **Work preferences:** \"Any strong preferences for how I should work with you? Communication style, code conventions, things that bug you?\"");
      plan.push("   → Write preference memories with strength: strong");
      plan.push("");
      plan.push("5. **Goals:** \"What are you working toward right now — professionally or personally?\"");
      plan.push("   → Write goal memories with timeline and status");
      plan.push("");
      plan.push("6. **Fill entity gaps:** If the scan didn't surface certain entity types (places, events, facts), ask about them specifically.");
      plan.push("   → e.g., \"Where are you based?\" → place memory");
      plan.push("   → e.g., \"Any upcoming deadlines or milestones?\" → event memories");
      plan.push("");
      plan.push("7. **Catch-all:** \"Anything else I should know about you that would help me be more useful?\"");
      plan.push("   → Write whatever comes up");
    } else {
      plan.push("### Cold start questions (no scan data available):");
      plan.push("");
      plan.push("1. \"Tell me about yourself — name, what you do, where you're based.\"");
      plan.push("   → person + organization + place memories");
      plan.push("");
      plan.push("2. \"What are you working on right now?\"");
      plan.push("   → project memories");
      plan.push("");
      plan.push("3. \"Who do you work with most closely?\"");
      plan.push("   → person memories with relationships");
      plan.push("");
      plan.push("4. \"What tools and technologies do you use daily?\"");
      plan.push("   → preference and fact memories");
      plan.push("");
      plan.push("5. \"Any strong preferences for how I should communicate or work with you?\"");
      plan.push("   → preference memories");
      plan.push("");
      plan.push("6. \"What are your current goals or priorities?\"");
      plan.push("   → goal memories");
      plan.push("");
      plan.push("7. \"Anything else I should remember?\"");
      plan.push("   → catch-all");
    }
  }

  // Phase 3: Review prompt
  plan.push("");
  plan.push("---");
  plan.push("");
  plan.push("## Phase 3: Review");
  plan.push("");
  plan.push("After scanning and interviewing, tell the user:");
  plan.push("");
  plan.push("\"I've seeded your memory with [N] memories from [sources]. You can review and correct them at **localhost:3838** — anything I got wrong, click to edit or remove. Confirming memories boosts their confidence score.\"");
  plan.push("");
  plan.push("If the dashboard has a review queue or unreviewed filter, mention it specifically.");

  // Log the onboarding event
  const eventId = crypto.randomUUID();
  const now = new Date().toISOString();
  sqlite.prepare(`
    INSERT INTO memory_events (id, memory_id, event_type, agent_id, agent_name, new_value, timestamp)
    VALUES (?, 'system', 'onboard_started', ?, ?, ?, ?)
  `).run(
    eventId,
    args.source_agent_id || "unknown",
    args.source_agent_name || "unknown",
    JSON.stringify({
      memory_count: totalMemories,
      tools_detected: { calendar: hasCalendar, email: hasEmail, github: hasGitHub, slack: hasSlack, notes: hasNotes },
    }),
    now,
  );

  return textResult(plan.join("\n"));
}
```

### Auto-hint on empty results

In the `memory_search` handler, when the DB has < 5 memories and the search returns 0 results, append a hint to the response:

```typescript
// At the end of the memory_search handler, after building the results:
if (results.length === 0) {
  const totalCount = sqlite.prepare("SELECT COUNT(*) as count FROM memories WHERE deleted_at IS NULL").get() as { count: number };
  if (totalCount.count < 5) {
    // Append onboarding hint
    const hint = "\n\n---\nNote: Your memory database is nearly empty. Call `memory_onboard` with your list of available tools to run a guided setup that seeds memories from your calendar, email, GitHub, and a short interview.";
    return textResult(searchResponse + hint);
  }
}
```

This makes onboarding discoverable without the user needing to know about it.

## Part 2: Dashboard Empty State + Review Mode

### Empty state on main page

Update `packages/dashboard/src/app/page.tsx`:

When the memory count is 0, show an empty state instead of the memory list:

```typescript
// At the top of the page component, after fetching memories:
if (total === 0) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
      <div className="w-16 h-16 mb-6 rounded-full bg-[var(--color-accent-soft)] flex items-center justify-center">
        {/* Brain/sparkle icon from lucide-react */}
        <Sparkles className="w-8 h-8 text-[var(--color-accent)]" />
      </div>
      <h2 className="text-2xl font-semibold mb-2">No memories yet</h2>
      <p className="text-[var(--color-text-secondary)] max-w-md mb-8">
        Your memory database is empty. Start a conversation with your AI assistant and say:
      </p>
      <Card className="p-4 max-w-lg w-full mb-4">
        <code className="text-sm text-[var(--color-accent-text)] font-mono">
          "Help me set up Engrams"
        </code>
      </Card>
      <p className="text-xs text-[var(--color-text-muted)]">
        Your AI will scan your connected tools and ask a few questions to seed your memory.
      </p>
    </div>
  );
}
```

### Unreviewed memories filter

Add a filter/view for newly seeded memories that haven't been confirmed yet. These are memories with `confirmed_count = 0` and `source_type = 'inferred'`.

In `packages/dashboard/src/components/memory-filters.tsx`, add a filter option:

```typescript
// Add to the existing filter options:
{
  label: "Needs review",
  value: "needs_review",
  description: "Unconfirmed memories from onboarding and automated extraction"
}
```

In `packages/dashboard/src/lib/db.ts`, handle this filter in the query:

```typescript
if (filter === "needs_review") {
  conditions.push("confirmed_count = 0 AND source_type = 'inferred'");
}
```

### Review banner

When there are unreviewed memories (confirmed_count = 0, source_type = 'inferred'), show a banner at the top of the main page:

```typescript
// In page.tsx, before the memory list:
const unreviewedCount = getUnreviewedCount(); // new db function

{unreviewedCount > 0 && (
  <Card className="p-3 mb-4 border-[var(--color-accent)] bg-[var(--color-accent-soft)]">
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <AlertCircle className="w-4 h-4 text-[var(--color-accent)]" />
        <span className="text-sm">
          <strong>{unreviewedCount}</strong> memories need review from onboarding
        </span>
      </div>
      <a href="/?filter=needs_review" className="text-sm text-[var(--color-accent)] hover:underline">
        Review now
      </a>
    </div>
  </Card>
)}
```

### DB helper

Add to `packages/dashboard/src/lib/db.ts`:

```typescript
export function getUnreviewedCount(): number {
  const db = getReadDb();
  const result = db.prepare(`
    SELECT COUNT(*) as count FROM memories 
    WHERE confirmed_count = 0 AND source_type = 'inferred' AND deleted_at IS NULL
  `).get() as { count: number };
  return result.count;
}
```

## Part 3: `memory_import` MCP Tool

A companion tool for structured imports from known formats:

```typescript
{
  name: "memory_import",
  description: "Import memories from a known format. Parses the source, deduplicates against existing memories, and writes new ones. Supported sources: claude-memory (MEMORY.md files), chatgpt-export (OpenAI memory export JSON), cursorrules (.cursorrules files), gitconfig (.gitconfig).",
  inputSchema: {
    type: "object",
    properties: {
      source_type: {
        type: "string",
        enum: ["claude-memory", "chatgpt-export", "cursorrules", "gitconfig", "plaintext"],
        description: "The format of the source data"
      },
      content: {
        type: "string",
        description: "The raw content to import. For file-based sources, pass the file contents."
      },
      domain: {
        type: "string",
        description: "Domain to assign to imported memories. Default: 'general'."
      }
    },
    required: ["source_type", "content"]
  }
}
```

### Handler

```typescript
case "memory_import": {
  const sourceType = args.source_type as string;
  const content = args.content as string;
  const domain = (args.domain as string) || "general";

  // Parse into individual memory strings based on source type
  let entries: { content: string; detail?: string }[] = [];

  switch (sourceType) {
    case "claude-memory": {
      // MEMORY.md format: each line starting with "- " is a memory
      // Lines starting with "- [" have a topic tag: "- [Topic] Memory content"
      entries = content
        .split("\n")
        .filter(line => line.trim().startsWith("- "))
        .map(line => {
          const text = line.replace(/^-\s*/, "").trim();
          const tagMatch = text.match(/^\[([^\]]+)\]\s*(.+)/);
          if (tagMatch) {
            return { content: tagMatch[2], detail: `Topic: ${tagMatch[1]}` };
          }
          return { content: text };
        })
        .filter(e => e.content.length > 5); // Skip trivially short entries
      break;
    }

    case "chatgpt-export": {
      // OpenAI memory export is a JSON array of { "memory": "..." } objects
      try {
        const parsed = JSON.parse(content);
        const items = Array.isArray(parsed) ? parsed : parsed.memories || parsed.results || [];
        entries = items
          .map((item: unknown) => {
            const text = typeof item === "string" ? item : (item as Record<string, string>).memory || (item as Record<string, string>).content || "";
            return { content: text };
          })
          .filter((e: { content: string }) => e.content.length > 5);
      } catch {
        return textResult({ error: "Failed to parse ChatGPT export JSON. Expected an array of { memory: string } objects." });
      }
      break;
    }

    case "cursorrules": {
      // .cursorrules: each line or paragraph is a rule/preference
      entries = content
        .split(/\n\n+/)
        .flatMap(block => {
          // If block has bullet points, split on those
          if (block.includes("\n- ")) {
            return block.split("\n- ").map(line => ({
              content: line.replace(/^-\s*/, "").trim(),
              detail: "Imported from .cursorrules",
            }));
          }
          return [{ content: block.trim(), detail: "Imported from .cursorrules" }];
        })
        .filter(e => e.content.length > 5);
      break;
    }

    case "gitconfig": {
      // Extract identity and key settings
      const nameMatch = content.match(/name\s*=\s*(.+)/i);
      const emailMatch = content.match(/email\s*=\s*(.+)/i);
      const editorMatch = content.match(/editor\s*=\s*(.+)/i);

      if (nameMatch) {
        entries.push({
          content: `User's name is ${nameMatch[1].trim()}`,
          detail: emailMatch ? `Email: ${emailMatch[1].trim()}` : undefined,
        });
      }
      if (editorMatch) {
        entries.push({
          content: `Prefers ${editorMatch[1].trim()} as git editor`,
          detail: "From .gitconfig",
        });
      }
      // Extract aliases
      const aliasSection = content.match(/\[alias\]([\s\S]*?)(?=\n\[|$)/i);
      if (aliasSection) {
        entries.push({
          content: "Has custom git aliases configured",
          detail: `Aliases: ${aliasSection[1].trim().split("\n").slice(0, 5).join("; ")}`,
        });
      }
      break;
    }

    case "plaintext": {
      // Each non-empty line is a memory
      entries = content
        .split("\n")
        .map(line => line.trim())
        .filter(line => line.length > 5)
        .map(line => ({ content: line }));
      break;
    }
  }

  if (entries.length === 0) {
    return textResult({ imported: 0, message: "No valid entries found in the provided content." });
  }

  // Deduplicate against existing memories
  let imported = 0;
  let skipped = 0;
  const results: { content: string; status: "imported" | "skipped_duplicate" }[] = [];

  for (const entry of entries) {
    // Quick dedup: search for similar content
    // Use FTS5 to check for high-overlap matches
    const searchTerms = entry.content
      .split(/\s+/)
      .filter(w => w.length > 3)
      .slice(0, 5)
      .join(" ");

    if (searchTerms.length > 0) {
      const existing = sqlite.prepare(`
        SELECT m.id, m.content FROM memories m
        JOIN memory_fts fts ON fts.rowid = m.rowid
        WHERE memory_fts MATCH ? AND m.deleted_at IS NULL
        LIMIT 3
      `).all(searchTerms) as { id: string; content: string }[];

      // Simple similarity check: if any existing memory shares >60% of words, skip
      const entryWords = new Set(entry.content.toLowerCase().split(/\s+/).filter(w => w.length > 3));
      const isDuplicate = existing.some(ex => {
        const exWords = ex.content.toLowerCase().split(/\s+/).filter(w => w.length > 3);
        const overlap = exWords.filter(w => entryWords.has(w)).length;
        return overlap / Math.max(entryWords.size, 1) > 0.6;
      });

      if (isDuplicate) {
        skipped++;
        results.push({ content: entry.content.slice(0, 80), status: "skipped_duplicate" });
        continue;
      }
    }

    // Write the memory
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    sqlite.prepare(`
      INSERT INTO memories (id, content, detail, domain, source_agent_id, source_agent_name, source_type, source_description, confidence, learned_at, updated_at)
      VALUES (?, ?, ?, ?, 'import', 'memory_import', 'inferred', ?, 0.5, ?, ?)
    `).run(id, entry.content, entry.detail || null, domain, `Imported from ${sourceType}`, now, now);

    // Update FTS
    sqlite.prepare(`INSERT INTO memory_fts (rowid, content, detail) SELECT rowid, content, detail FROM memories WHERE id = ?`).run(id);

    imported++;
    results.push({ content: entry.content.slice(0, 80), status: "imported" });

    // Fire-and-forget entity extraction (if LLM provider is available)
    // Same pattern as memory_write — queue background extraction
  }

  // Log the import event
  sqlite.prepare(`
    INSERT INTO memory_events (id, memory_id, event_type, new_value, timestamp)
    VALUES (?, 'system', 'import', ?, ?)
  `).run(
    crypto.randomUUID(),
    JSON.stringify({ source_type: sourceType, imported, skipped, total_entries: entries.length }),
    new Date().toISOString(),
  );

  return textResult({
    imported,
    skipped_duplicates: skipped,
    total_parsed: entries.length,
    note: imported > 0
      ? `Imported ${imported} memories at confidence 0.5 (unreviewed). Confirm them in the dashboard or via memory_confirm to boost confidence.`
      : "All entries were duplicates of existing memories.",
  });
}
```

Key design decisions:
- **Imported memories start at confidence 0.5** (below the normal 0.7 for direct writes). They're usable but clearly flagged as needing review.
- **Source type is `inferred`** so the dashboard "Needs Review" filter catches them.
- **Dedup is word-overlap based** — fast and good enough for import. Not embedding-based (too slow for batch).
- **Entity extraction fires in the background** just like normal `memory_write` — imported memories get classified automatically.

## Part 4: README Update

Add an "Getting Started" section to `README.md` after the install section:

```markdown
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
```

## File Changes Summary

| File | Changes |
|------|---------|
| `packages/mcp-server/src/server.ts` | Add `memory_onboard` tool (plan generator), `memory_import` tool (batch import), auto-hint on empty search results |
| `packages/dashboard/src/app/page.tsx` | Empty state UI when 0 memories, review banner when unreviewed memories exist |
| `packages/dashboard/src/components/memory-filters.tsx` | Add "Needs review" filter option |
| `packages/dashboard/src/lib/db.ts` | Add `getUnreviewedCount()`, add `needs_review` filter to query |
| `README.md` | Add "Getting Started" and "Importing Existing Memories" sections |

## Verification

```bash
pnpm build && pnpm test
```

Then test:

1. **Empty DB — search hint:** Clear your DB (or use a fresh `~/.engrams/test.db`), call `memory_search` for anything. Verify the response includes the `memory_onboard` hint.

2. **Onboarding with tools:** Call `memory_onboard` with `available_tools: ["gcal_list_events", "gmail_search_messages"]`. Verify the plan includes Calendar and Email scan sections with specific instructions, plus the informed interview questions that reference scan results.

3. **Onboarding without tools:** Call `memory_onboard` with no `available_tools`. Verify it falls back to Local Files scan + cold start interview questions.

4. **Onboarding with existing memories:** Seed 50+ memories, then call `memory_onboard`. Verify it shows current entity coverage, identifies gaps, and generates enrichment-focused questions.

5. **Import — Claude memory:** Create a test MEMORY.md:
   ```
   - [Work] James is a PM at Sunrise Labs
   - [Preferences] Prefers TypeScript over JavaScript
   - Uses Engrams for AI memory
   ```
   Call `memory_import` with `source_type: "claude-memory"` and the content. Verify 3 memories created at confidence 0.5 with source_type "inferred".

6. **Import — dedup:** Run the same import again. Verify all 3 are skipped as duplicates.

7. **Import — ChatGPT:** Test with `[{"memory": "User lives in San Francisco"}, {"memory": "User prefers dark mode"}]`. Verify 2 memories created.

8. **Dashboard empty state:** Clear DB, open localhost:3838. Verify the empty state shows with the "Help me set up Engrams" prompt.

9. **Dashboard review banner:** Import 10 memories, open dashboard. Verify the review banner shows "10 memories need review" with a link to the filtered view.

10. **Needs review filter:** Click the review link or select "Needs review" filter. Verify only unconfirmed inferred memories show. Confirm one, verify it disappears from the filtered view.

Commit and push when complete.
