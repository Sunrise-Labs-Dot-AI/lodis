import type { Chapter, ChapterId } from "./types.js";

export const CHAPTERS: Chapter[] = [
  {
    id: "overview",
    title: "What Lodis is",
    oneLiner: "Lodis gives your AI agents a memory that's yours, not the tool's.",
    dashboardAnchor: "/",
    sections: [
      {
        heading: "The problem",
        body: "Every AI tool you use — Claude, ChatGPT, Cursor, Windsurf — keeps its own separate memory of you. Switch tools and you start over. Cancel a subscription and your context disappears. Your agents don't know each other exists.",
      },
      {
        heading: "What Lodis does",
        body: "Lodis is an open-source MCP server plus a local web dashboard. Any MCP-compatible tool connects to the same memory layer. You own the database. You browse, search, confirm, and correct what your agents know through a real UI — not chat commands.",
      },
      {
        heading: "Why it matters for you",
        body: "You get one memory that follows you across every tool. It runs locally (SQLite at ~/.lodis/lodis.db). It's MIT-licensed. And because it's an MCP server, every agent you add inherits the same context automatically.",
        codeExample: "# In Claude, Cursor, Windsurf — all pointing at the same memory\nnpx lodis init\n# → registers lodis as an MCP server for every MCP-compatible client",
      },
    ],
    tools: [
      { name: "memory_tutorial", blurb: "This tool. Teaches you (or an agent) how Lodis works, chapter by chapter." },
    ],
    tryItNext: [
      {
        toolName: "memory_tutorial",
        naturalLanguage: "Walk through the next chapter on writing memories",
        exampleInvocation: "memory_tutorial({ chapter: \"write\" })",
      },
    ],
  },
  {
    id: "write",
    title: "Writing memories",
    oneLiner: "Every write runs dedup detection, entity extraction, and confidence scoring.",
    dashboardAnchor: "/",
    sections: [
      {
        heading: "How writes work",
        body: "Call memory_write with a short fact. Lodis runs hybrid search to check for similar memories, extracts entities in the background via LLM, and stores the result with an initial confidence score based on source type (stated 0.90, observed 0.75, inferred 0.65).",
        codeExample: "memory_write({\n  content: \"I work at Mill as a principal engineer\",\n  source_type: \"stated\"\n})",
      },
      {
        heading: "Dedup in the loop",
        body: "If a similar memory already exists (RRF > 0.7 plus entity match), Lodis returns similar_found with five resolution options: update, correct, add_detail, keep_both, skip. The agent decides in real time — no silent duplicates, no silent overwrites.",
      },
      {
        heading: "Entity extraction",
        body: "Entities are classified into 13 types: person, organization, place, project, preference, event, goal, fact, lesson, routine, skill, resource, decision. Connections between entities (works_at, involves, located_at) are created automatically.",
      },
    ],
    tools: [
      { name: "memory_write", blurb: "Create a memory. Returns the memory plus dedup hits if any.", example: "memory_write({ content: \"I work at Mill\" })" },
      { name: "memory_update", blurb: "Modify content, detail, or metadata of an existing memory." },
    ],
    tryItNext: [
      {
        toolName: "memory_write",
        naturalLanguage: "Write one fact about yourself so we can search it in the next chapter",
        exampleInvocation: "memory_write({ content: \"I am preparing for an Anthropic PM interview\" })",
      },
    ],
  },
  {
    id: "search",
    title: "Searching memories",
    oneLiner: "Hybrid search via Reciprocal Rank Fusion — keyword and semantic together.",
    dashboardAnchor: "/",
    sections: [
      {
        heading: "Three search modes",
        body: "memory_search returns ranked memories. memory_context returns a token-budget-aware pack for building a response. memory_briefing returns a pre-computed entity profile (24h cache) — best for 'tell me about Sarah' questions.",
        codeExample: "memory_search({ query: \"Lodis\" })\nmemory_context({ query: \"what am I working on?\", token_budget: 2000 })\nmemory_briefing({ entity_name: \"Mill\" })",
      },
      {
        heading: "How hybrid ranking works",
        body: "Every search runs two queries in parallel: FTS5 keyword search and sqlite-vec cosine similarity over 384-dim embeddings. Results merge via Reciprocal Rank Fusion (k=60), then get boosted by confidence and recency. Graph expansion adds up to 3 hops for related memories.",
      },
    ],
    tools: [
      { name: "memory_search", blurb: "Hybrid ranked search with domain, confidence, and entity filters." },
      { name: "memory_context", blurb: "Token-budget-aware retrieval. Returns hierarchical or narrative output." },
      { name: "memory_briefing", blurb: "Entity profile summary with 24h cache — best for people/projects/places." },
    ],
    tryItNext: [
      {
        toolName: "memory_search",
        naturalLanguage: "Search for the memory you just wrote",
        exampleInvocation: "memory_search({ query: \"Anthropic\" })",
      },
    ],
  },
  {
    id: "trust",
    title: "Trust and confidence",
    oneLiner: "Every memory has a confidence score that changes with use, confirmation, and time.",
    dashboardAnchor: "/",
    sections: [
      {
        heading: "The confidence engine",
        body: "Confidence starts based on source type, then updates on every interaction. Confirm a memory and it jumps to 0.99. Flag a mistake and it drops 0.15. Use it in a response and it gains 0.02. Memories decay 0.01 per 30 days unless pinned — stale facts sink, fresh ones float.",
      },
      {
        heading: "Corrections and mistakes",
        body: "When you correct a memory, Lodis uses the LLM to do a semantic diff — the new content replaces the old, confidence resets to 0.50, and the history is logged. Flagging a mistake keeps the memory but degrades confidence. Both actions leave an audit trail.",
        codeExample: "memory_confirm({ memory_id: \"abc123\" })         // → confidence 0.99\nmemory_flag_mistake({ memory_id: \"abc123\" }) // → confidence -0.15\nmemory_correct({ memory_id: \"abc123\", new_content: \"...\" })",
      },
    ],
    tools: [
      { name: "memory_confirm", blurb: "Mark a memory as verified. Confidence → 0.99." },
      { name: "memory_correct", blurb: "LLM-powered semantic diff correction. Confidence resets to 0.50." },
      { name: "memory_flag_mistake", blurb: "Degrade a memory's confidence without deleting it." },
      { name: "memory_pin", blurb: "Pin as canonical — immune to decay, boosted in search." },
    ],
    tryItNext: [
      {
        toolName: "memory_confirm",
        naturalLanguage: "Confirm one of the memories you wrote earlier to watch confidence jump",
      },
    ],
  },
  {
    id: "permissions",
    title: "Agent permissions",
    oneLiner: "Per-agent read/write access, scoped by domain — so Cursor can't read your therapy notes.",
    dashboardAnchor: "/agents",
    sections: [
      {
        heading: "Why permissions",
        body: "Not every agent deserves full access to your memory. Cursor probably needs code context. Your journaling agent needs personal context. Your work-task agent needs neither. Lodis enforces this at every read and write path via checkPermission.",
      },
      {
        heading: "How to set permissions",
        body: "memory_set_permissions grants or revokes read/write access per agent, per domain. Domains are free-form strings you assign at write time. An agent with no explicit permission falls through to the default policy.",
        codeExample: "memory_set_permissions({\n  agent_id: \"cursor\",\n  domain: \"work\",\n  can_read: true,\n  can_write: true\n})",
      },
      {
        heading: "Managing permissions visually",
        body: "The dashboard /agents page lists every agent that has ever written a memory, with a grid of checkboxes for read/write across every domain. Revoke access with one click — the next read from that agent returns nothing for that domain.",
      },
    ],
    tools: [
      { name: "memory_set_permissions", blurb: "Per-agent read/write access control by domain." },
      { name: "memory_list_domains", blurb: "List every domain with memory counts." },
    ],
    tryItNext: [
      {
        toolName: "memory_set_permissions",
        naturalLanguage: "Restrict this agent to read-only on a specific domain",
        exampleInvocation: "memory_set_permissions({ agent_id: \"claude\", domain: \"personal\", can_read: true, can_write: false })",
      },
    ],
  },
];

export function listChapters(): Chapter[] {
  return CHAPTERS;
}

export function getChapter(id: ChapterId): Chapter {
  const chapter = CHAPTERS.find((c) => c.id === id);
  if (!chapter) {
    throw new Error(`Unknown chapter: ${id}`);
  }
  return chapter;
}

export function isKnownChapterId(id: string): id is ChapterId {
  return CHAPTERS.some((c) => c.id === id);
}
