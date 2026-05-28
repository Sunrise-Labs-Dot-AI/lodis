# Lodis Competitive Scan: Off-the-Shelf Memory Layers for AI Agents
**Date: May 27, 2026 | Prepared for: James Heath**

---

## Hard Filter Applied

> **A memory layer must function as ONE shared brain across many projects AND many tools simultaneously. It fails if memory is per-project, per-app, per-vendor-surface, or inaccessible to non-native tools.**

Every candidate is evaluated against this filter before any other analysis.

---

## Candidate Assessments

### 1. Mem0 (mem0.ai) + OpenMemory MCP

**Cross-project: PASS | Cross-tool: PASS**

Mem0's architecture uses four explicit scope identifiers — `user_id`, `agent_id`, `app_id`, and `run_id` — and memory retrieval composes across them, so a single `user_id` can pull memories deposited by Claude, Cursor, a custom Python agent, or any other MCP client simultaneously ([Mem0 State of AI Agent Memory 2026](https://mem0.ai/blog/state-of-ai-agent-memory-2026)). OpenMemory MCP, the local-first variant, runs as a shared MCP server on `http://localhost:3000` and is designed explicitly to "create a shared, persistent memory layer for your MCP-compatible tools" — memory persists across Claude Desktop, Cursor, Windsurf, VS Code, and any other MCP client connecting to the same process ([OpenMemory MCP introduction](https://mem0.ai/blog/introducing-openmemory-mcp)). Both passes are well-evidenced.

**MCP support:** Native MCP server available at `mcp.mem0.ai` (hosted) and via the OpenMemory local stack. 9 MCP tools: add, search, get, update, delete, bulk delete, entity management ([Mem0 changelog](https://docs.mem0.ai/changelog/highlights)). Self-host is fully supported via Docker (FastAPI + PostgreSQL/pgvector + Neo4j) under Apache 2.0 ([self-host guide](https://mem0.ai/blog/self-host-mem0-docker)).

**Cost model:** Free tier: 10,000 add requests / 1,000 retrieval requests / month / 1 project. Starter $19/mo (50K/5K), Growth $79/mo, Pro $249/mo (graph memory, advanced retrieval, SOC 2/HIPAA), Enterprise custom with on-prem ([Mem0 pricing](https://mem0.ai/pricing)). Self-host (OSS) is free under Apache 2.0 with Ollama substitutable for both the LLM extractor and embedding model — switching to Ollama eliminates all per-call spend ([self-host Ollama config](https://mem0.ai/blog/self-host-mem0-docker)). **Important caveat:** graph memory (Neo4j entity extraction) requires 3 LLM calls per `add_memory` on ingest when enabled; graph is off by default in OSS ([Reddit self-host implementation post](https://www.reddit.com/r/ClaudeAI/comments/1r6r87z/i_built_a_selfhosted_mem0_mcp_memory_server_for/)). The managed cloud path always calls an LLM on ingest; the OSS local path with Ollama does not send to external services.

**Automatic memory management:** Auto-extraction of discrete facts from raw text on write (LLM-powered). Auto-contradiction resolution on write — Mem0 self-edits rather than appending duplicates ("when facts conflict, Mem0 self-edits rather than appending duplicates") ([Atlan comparison 2026](https://atlan.com/know/best-ai-agent-memory-frameworks-2026/)). Multi-signal retrieval fuses semantic similarity, keyword matching, and entity matching ([State of AI Agent Memory 2026](https://mem0.ai/blog/state-of-ai-agent-memory-2026)). No native time-decay/auto-forget documented — **cannot verify** if TTL or confidence decay is supported in OSS. Knowledge graph auto-built from entities when Neo4j is enabled.

**Dashboard:** Yes — OpenMemory ships a local dashboard at `http://localhost:3000` for browsing, tagging, and managing memories ([OpenMemory MCP intro](https://mem0.ai/blog/introducing-openmemory-mcp)).

**Maturity & momentum:** Apache 2.0, ~48K GitHub stars as of early 2026, YC S24, chosen as memory provider for AWS Agents ([Reddit post from Mem0 co-founder](https://www.reddit.com/r/PromptEngineering/comments/1r967vj/)). Most widely adopted memory library in the space. Production-ready.

**Migration in (3,000 memories from JSON):** Yes — `mem0 import data.json --user-id alice` accepts a JSON array with `memory`/`text`/`content` field plus optional `user_id`, `agent_id`, `metadata` ([Mem0 CLI docs](https://docs.mem0.ai/platform/cli)). Domain, entity type, and confidence can be passed in metadata. Timestamps are not explicitly documented as importable fields — **partially unverifiable** whether timestamps and confidence scores survive round-trip.

---

### 2. Zep (getzep.com) + Graphiti

**Zep Cloud — Cross-project: PASS | Cross-tool: PASS (via Graphiti MCP)**
**Zep self-hosted — FAIL (Community Edition deprecated April 2025)**

Zep Cloud is a workspace-scoped service where memory is organized around user and thread IDs, not by product or tool surface — any client with valid credentials can write and read. Graphiti MCP, Zep's open-source graph engine, explicitly advertises cross-tool shared memory: "brainstorm in Claude Desktop and execute in Cursor," with memory persisting "across all clients" ([Zep Graphiti MCP page](https://www.getzep.com/product/knowledge-graph-mcp/)).

**Zep Community Edition status:** **Deprecated April 2025 with additional feature retirements February 2026** ([Zep FAQ](https://help.getzep.com/faq); [Atlan Zep vs Mem0 2026](https://atlan.com/know/zep-vs-mem0/)). The community edition code is moved to a `legacy/` folder ([Zep GitHub](https://github.com/getzep/zep)). Self-hosting today means either Zep Cloud BYOC (enterprise-only, VPC residency) or building on raw Graphiti — which is Apache 2.0 but requires provisioning Graphiti + a compatible graph DB (Neo4j, FalkorDB, or Kuzu) independently, a minimum three-system stack.

**MCP support:** Graphiti MCP Server 1.0 (released November 2025, 20K GitHub stars) runs locally with Neo4j ([Graphiti 20K stars post](https://blog.getzep.com/graphiti-hits-20k-stars-mcp-server-1-0/)). Zep Cloud does not expose an MCP server directly — it uses REST/Python/TypeScript/Go SDKs.

**Cost model (Zep Cloud):** Credit-based pricing where every memory operation (add, search, episode processing) consumes credits — described as "hard to predict" for high-volume workloads ([Vectorize Zep alternatives 2026](https://vectorize.io/articles/zep-alternatives)). Free tier exists. Graphiti OSS + Neo4j is free to self-host; Neo4j Community is free for single-node.

**LLM calls on ingest:** Graphiti performs LLM calls during episode processing to extract entities and relationships. Supported LLM providers include OpenAI, Anthropic, Google, Azure, and local models via Ollama/embeddings ([Graphiti MCP 1.0 Reddit post](https://www.reddit.com/r/LLMDevs/comments/1oub14b/)). Local Ollama option confirmed for fully offline operation. **Caveat:** Cognee's authors noted that smaller models (<32B parameters) sometimes fail to produce valid graph structures — likely applicable to Graphiti too ([Cognee Ollama tutorial YouTube](https://www.youtube.com/watch?v=aZYRo-eXDzA)).

**Automatic memory management:** Temporal bi-temporal knowledge graph — every fact tracks event time (when it happened) and ingestion time (when the system learned it), with validity windows that auto-invalidate stale facts ([Atlan AI Memory Frameworks 2026](https://atlan.com/know/best-ai-agent-memory-frameworks-2026/)). This is Zep's defining architectural advantage: "Kendra loves Adidas shoes (as of March 2026)" is stored as a fact with a temporal bound, automatically superseded when contradicted. Auto-entity resolution, auto-relationship building, hybrid retrieval (semantic + BM25 + graph traversal without LLM at query time). Auto-graph building is always on.

**Dashboard:** Zep Cloud has a management console. Graphiti standalone — **cannot verify** a dedicated dashboard UI exists; Neo4j's own browser provides graph visualization.

**Maturity & momentum:** Graphiti Apache 2.0, ~20K stars (November 2025). Zep Cloud SOC 2 Type II + HIPAA BAA on enterprise. Active in 2026. Migration away from CE is a source of user friction.

**Migration in:** Zep provides a documented Mem0-to-Zep migration guide (published May 24, 2026), mapping `user_id` and thread IDs, ingesting JSON/text via `graph.add` ([Zep Mem0 migration docs](https://help.getzep.com/mem0-to-zep)). Graphiti can ingest JSON directly as episodes. Confidence scores and permanence tiers would need mapping — **partially unverifiable** whether Lodis's exact schema survives import without transformation.

---

### 3. Supermemory (supermemory.ai)

**Cross-project: PARTIAL | Cross-tool: PASS**

Supermemory's default behavior is a single shared memory across all MCP clients that connect with the same API key — it explicitly markets as "Universal Memory MCP makes your memories available to every single LLM" and supports Claude Desktop, Cursor, VS Code, Gemini CLI, Claude Code, Cline simultaneously via a single account ([Supermemory MCP GitHub](https://github.com/supermemoryai/supermemory-mcp); [Supermemory MCP sharing blog](https://supermemory.ai/blog/how-to-make-your-mcp-clients-share-context-with-supermemory-mcp/)). Cross-tool is a genuine PASS.

The cross-project verdict is PARTIAL because Supermemory introduces `containerTag` for project scoping — when the MCP header `x-sm-project` is set, memory retrieval is scoped to that project/tag only ([Supermemory MCP docs](https://supermemory.ai/docs/supermemory-mcp/mcp)). Without scoping, all memories from all projects flow into one pool (which is the desired behavior for the hard filter). With deliberate tagging, projects are isolated. The architecture supports the cross-project shared brain use case, but requires the caller **not** to set project scoping — a configuration nuance worth noting.

**MCP support:** Native hosted MCP server at `https://mcp.supermemory.ai/mcp` with OAuth or API key auth ([Supermemory MCP docs](https://supermemory.ai/docs/supermemory-mcp/mcp)). Self-host is available on Scale ($399/mo) and Enterprise tiers; the self-host deployment requires Cloudflare Workers, Durable Objects, Postgres, and an OpenAI API key for embeddings — **not a simple local deployment** ([Supermemory self-hosting docs](https://supermemory.ai/docs/deployment/self-hosting)).

**Cost model:** Free (includes $5/mo usage credit), Scale $399/mo (~$600/mo usage included), Enterprise custom ([Supermemory pricing](https://supermemory.ai)). Usage is billed per "SM tokens" ingested: $0.005/1K plain text, $0.010/1K rich content. Self-host available at Scale+. The hosted service requires OpenAI for embeddings and extraction — **no documented path to fully local zero-LLM-spend operation**. Self-hosted deployment's env vars require `OPENAI_API_KEY` as mandatory ([self-hosting env table](https://supermemory.ai/docs/deployment/self-hosting)).

**Automatic memory management:** Auto-extraction and profile building from ingested content. Contradiction resolution documented in marketing ("Supermemory wraps memory management: extraction, profile building, contradiction resolution, and forgetting, behind a single API surface") ([Atlan AI Memory Frameworks 2026](https://atlan.com/know/best-ai-agent-memory-frameworks-2026/)). Knowledge graph generation ("Intelligent knowledge graphs: Automatically create intuitive, visual graphs of your knowledge") mentioned in the unified memory blog post ([Supermemory unified memory blog](https://supermemory.ai/blog/unified-memory-that-works-where-you-work-your-second-brain-with-supermemory/)) — **cannot verify** graph depth vs. Zep/Graphiti from official API docs. Implicit connection-making documented as a capability.

**Dashboard:** Yes — `app.supermemory.ai` with memory browsing, tagging, project organization, knowledge graph visualization, connector management.

**Maturity & momentum:** MIT-licensed core MCP ([GitHub repo](https://github.com/supermemoryai/supermemory-mcp)). The self-hosted enterprise stack's license is not clearly documented as open source — **cannot verify** terms. Active changelogs through April 2026 ([Supermemory changelog](https://supermemory.ai/docs/changelog/overview)). SOC 2 + HIPAA BAA on Scale/Enterprise.

**Migration in:** Batch ingest API (`POST /v3/documents/batch`) available since the 2026 changelog ([changelog](https://supermemory.ai/docs/changelog/overview)). No documented import of confidence scores, permanence tiers, or typed entity relationships from a JSON dump — **unverifiable** whether Lodis's full schema maps cleanly.

---

### 4. Letta (formerly MemGPT)

**Cross-project: PASS | Cross-tool: PARTIAL**

Letta is an agent runtime, not a memory layer. Its memory architecture (core memory blocks, recall memory, archival memory) is owned by individual agents, but the Shared Memory Blocks API allows multiple agents to attach and write to a single shared block — enabling cross-agent memory ([Letta shared memory blocks docs](https://docs.letta.com/tutorials/shared-memory-blocks/)). The Letta API supports REST-based access, so any system that can call an HTTP endpoint can read/write memory ([Letta API](https://www.letta.com)). Cross-project PASS: memory is keyed by agent ID and block ID, not by project.

Cross-tool is PARTIAL: any tool that can make REST API calls to the Letta server can access agent memory programmatically. However, Letta does not expose a native MCP server that can be dropped into an existing MCP configuration ([Vectorize best AI agent memory 2026](https://vectorize.io/articles/best-ai-agent-memory-systems)). The March 2026 roadmap explicitly deprecated server-side MCP integrations in favor of client-side skills ([Letta next phase blog](https://www.letta.com/blog/our-next-phase)). Non-Letta tools (Codex, Cursor, etc.) cannot plug into Letta memory without custom API integration — they can call Letta's REST API, but there's no plug-and-play path.

**MCP support:** No native MCP server as of May 2026 (deprecated by Letta's own roadmap). REST/SDK access available. Apache 2.0 self-host Docker supported.

**Cost model:** OSS Apache 2.0 (self-host free). Managed cloud pricing not prominently listed on the public site — **cannot verify** hosted tier pricing. LLM calls are made by the Letta agent itself (using whichever LLM provider you configure), not by the memory layer separately. Supports Ollama as a local LLM backend.

**Automatic memory management:** Agents self-edit their own memory blocks using LLM reasoning — "agents actively decide what to keep in context versus archive" ([Vectorize best AI memory 2026](https://vectorize.io/articles/best-ai-agent-memory-systems)). Sleep-time compute (background reflection, consolidation) is now client-side via subagents ([Letta next phase](https://www.letta.com/blog/our-next-phase)). Context Repositories (git-backed memory) introduced February 2026 — agents manage memory as versioned files with auto-reflection and defragmentation ([Letta context repos blog](https://www.letta.com/blog/context-repositories)). No dedicated auto-contradiction resolution or time-decay outside of what the agent LLM decides during reflection.

**Dashboard:** Yes — Agent Development Environment (ADE) for visual memory debugging and agent management.

**Maturity & momentum:** Apache 2.0, ~21K GitHub stars, active development through May 2026 (Letta Code v0.26.2 pushed May 25, 2026 per [GitHub](https://github.com/letta-ai/letta-code)). The platform is pivoting from a memory-layer to a full agent runtime, which means adopting Letta "just for memory" involves significant overhead.

**Migration in:** No documented bulk JSON import for existing memories with the Lodis schema. Letta's memory model is agent-centric (blocks, not a flat memory store), so migrating 3,000 Lodis memories would require mapping them to Letta agent memory blocks via API — **not a documented path**, would require custom scripting.

---

### 5. Cognee (open-source)

**Cross-project: PASS | Cross-tool: PASS (via MCP)**

Cognee is a Python framework that builds a knowledge graph + vector store from ingested documents. It includes an MCP server (`cognee-mcp` folder in repo) introduced in v0.3.5 ([Cognee MCP blog](https://www.cognee.ai/blog/cognee-news/introducing-cognee-mcp)). Any MCP-compatible client (Claude, Cursor, LangGraph) can connect to the same local Cognee instance. The shared data store (LanceDB for vectors, Kuzu for graphs, SQLite for metadata by default) is not scoped to a project — cross-project by default unless you build isolation on top. Cross-tool PASS via MCP.

**MCP support:** Native MCP server included since v0.3.5 (November 2025). Self-hosted, runs locally. Free.

**Cost model:** Free OSS under Apache 2.0, free local development. Cloud tiers: Developer $35/mo, Team $200/mo ([Cognee pricing](https://www.cognee.ai)). Self-host requires an LLM for graph extraction — OpenAI by default, configurable to Ollama ([Cognee LLM providers docs](https://docs.cognee.ai/setup-configuration/llm-providers)). Important caveat: **structured output reliability degrades significantly on smaller local models** (<32B parameters) — graph extraction often fails or produces malformed output on consumer hardware ([self-hosting Cognee blog](https://www.glukhov.org/ai-systems/memory/selfhosting-cognee-quickstart-llms-comparison/)). The zero-LLM-spend local path is technically available but practically unreliable below large model sizes.

**Automatic memory management:** Auto-graph construction from documents via `cognify()` — extracts entities and relationships using LLM-powered structured output. Vector + graph hybrid retrieval on `search()`. No documented time-decay, confidence scoring, or auto-contradiction resolution in the OSS core — **cannot verify** these features exist beyond marketing. No permanence tiers.

**Dashboard:** Yes — `cognee-cli -ui` starts a local UI ([Cognee GitHub](https://github.com/topoteretes/cognee)).

**Maturity & momentum:** Apache 2.0, ~14.1K stars, 85 releases, latest v0.5.5 March 14, 2026, 121 contributors ([GitHub](https://github.com/topoteretes/cognee)). Graduated GitHub Secure Open Source Program (August 2025). Actively maintained but smaller ecosystem than Mem0 or Graphiti.

**Migration in:** No documented bulk JSON import. The `cognee.add()` API ingests text/documents; Lodis's structured memory JSON would need transformation into text or structured input. Confidence scores, entity types, and permanence tiers have no direct equivalent — **migration would require significant custom work**.

---

### 6a. Claude Native Memory (Anthropic)

**Cross-project: FAIL | Cross-tool: PARTIAL**

**Standalone conversation memory vs. project memory are fully siloed.** "Memory only synthesizes from standalone conversations. Project chats have their own separate memory space. If you split your work between projects and regular chats, your memory context is split too" ([XTrace Claude memory 2026](https://xtrace.ai/blog/claude-memory-2026-limits-and-fixes)). Memory cannot flow freely across multiple Claude projects simultaneously — each project is a separate context container. **Hard filter FAIL on cross-project.**

Cross-tool is PARTIAL with important nuance:

- **Claude.ai / Claude Desktop / Claude Mobile:** Memory (both auto-synthesis and user-editable `memory_user_edits` tool) is the same system, synced across all three surfaces as of January 30, 2026 ([Limited Edition Jonathan Substack](https://limitededitionjonathan.substack.com/p/stop-re-introducing-yourself-to-claude)). These three share one pool.
- **Claude Code:** Auto memory per the official docs is **per-repository** ("Each project gets its own memory directory at `~/.claude/projects/<project>/memory/`") and is machine-local — not synced to Claude.ai ([Claude Code memory docs](https://code.claude.com/docs/en/memory)). A GitHub issue requesting Claude Code to access Claude.ai memory was filed December 2025 and remains open ([GitHub issue #14228](https://github.com/anthropics/claude-code/issues/14228)), confirming it is NOT shared as of May 2026.
- **Claude API (Messages API) memory tool (GA since early 2026):** This is a client-side file-system metaphor tool — your application code executes the file operations against whatever storage backend you choose ([Thomas Wiegold API memory guide](https://thomas-wiegold.com/blog/claude-api-memory-tool-guide/)). It is not the same store as Claude.ai memory; it's a framework for building your own persistent context. Programmatically accessible by non-Claude tools? Yes, because you own the storage backend — but it's not a ready-made cross-tool memory layer.
- **Claude Managed Agents memory stores (public beta April 23, 2026):** These are workspace-scoped memory stores attached to Managed Agent sessions via the `managed-agents-2026-04-01` beta header. Memory is stored as versioned markdown files in mounts; the API allows create/read/update/delete programmatically ([Claude API memory docs](https://platform.claude.com/docs/en/managed-agents/memory)). Maximum 8 stores per session; stores can be shared across sessions. **Can non-Claude tools read/write Managed Agent memory stores?** Yes — the REST API is open. However, the stores are coupled to Claude Managed Agent sessions and require the beta header. This is not a general-purpose cross-tool memory server.

**Export:** Claude.ai memory is exportable as JSON ([XTrace 2026](https://xtrace.ai/blog/claude-memory-2026-limits-and-fixes)). Import is not documented — **cannot verify** bulk import.

**Surprise finding:** Claude Managed Agents memory stores (beta as of April 23, 2026) are the closest Anthropic has come to a programmatic, API-accessible, workspace-scoped memory layer with versioning, redaction, and audit trail. They are significantly more capable than the consumer-facing claude.ai memory feature. However, they require Claude as the agent runtime and do not function as a general-purpose MCP memory server accessible to Cursor, Codex, or arbitrary scripts. **This does not clear the hard filter but is notable.**

**Maturity:** Claude.ai memory available to all users (including free) as of March 2, 2026 ([XTrace 2026](https://xtrace.ai/blog/claude-memory-2026-limits-and-fixes)). Managed Agent memory stores in public beta April 2026.

---

### 6b. ChatGPT Native Memory (OpenAI)

**Cross-project: FAIL | Cross-tool: FAIL**

ChatGPT memory is fundamentally personal and surface-locked. For non-Enterprise users, saved memories apply across general chats and (with default memory settings) can leak into projects — but projects with "project-only memory" enabled are fully siloed from other projects and from general ChatGPT ([OpenAI help center on projects](https://help.openai.com/en/articles/10169521-projects-in-chatgpt)). Enterprise users additionally have projects that are isolated from each other and from general chats. There is no mechanism to share one memory pool across projects. **Hard filter FAIL on cross-project.**

Cross-tool is a hard FAIL: "The API currently does not offer a memory function" — confirmed in the OpenAI developer community as of mid-2025 and remaining true as of May 2026 ([OpenAI community thread](https://community.openai.com/t/how-do-i-enable-or-disable-memory-in-api/703964); [OpenAI backend memory API thread](https://community.openai.com/t/backend-memory-api-availability/1327871)). ChatGPT memory is consumer-app only. Codex, Cursor, and user scripts have no programmatic API to read or write ChatGPT memories. OpenAI has not shipped a memory API despite repeated community requests.

**Export:** ChatGPT memory can be exported via settings. No documented import path. Third-party tools attempt programmatic access via browser automation, which is unsupported and fragile ([OpenAI export request thread](https://community.openai.com/t/feature-need-export-chat-and-memory-data-teams-subscription/812775)).

**Automatic memory management:** Auto-manages saved memories to prioritize relevant details and prevent "memory full" state; auto-sorts by recency and topic frequency ([ChatGPT release notes](https://help.openai.com/en/articles/6825453-chatgpt-release-notes)). Chat history reference (Plus/Pro paid feature) allows cross-chat retrieval. No temporal validity windows. No knowledge graph.

**Verdict:** ChatGPT native memory is unambiguously excluded by the hard filter on both cross-project and cross-tool axes. It is a consumer personalization feature, not a developer memory layer.

---

## Capability Matrix

| Product | Passes Hard Filter | Native MCP Server | Self-Host Free | Zero-LLM-Spend Option | Auto-Contradiction | Auto-Decay / Temporal | Auto-Graph | Dashboard | Maturity |
|---|---|---|---|---|---|---|---|---|---|
| **Mem0 / OpenMemory** | ✓ PASS both | ✓ hosted + local | ✓ Apache 2.0, Docker | ✓ Ollama (OSS) | ✓ self-editing on write [(Atlan)](https://atlan.com/know/best-ai-agent-memory-frameworks-2026/) | ✗ no documented decay | ✓ Neo4j (off by default, extra LLM calls) | ✓ local dashboard | ★★★★★ 48K stars, YC S24 |
| **Zep Cloud** | ✓ PASS both | ✗ no MCP (REST/SDK) | ✗ CE deprecated [(Zep FAQ)](https://help.getzep.com/faq) | ✗ cloud-only LLM | ✓ temporal invalidation | ✓ validity windows, bi-temporal | ✓ always on | ✓ cloud console | ★★★★☆ SOC2/HIPAA |
| **Graphiti (Zep OSS)** | ✓ PASS both | ✓ local MCP server | ✓ Apache 2.0 + Neo4j | ✓/partial Ollama (large models) | ✓ temporal invalidation | ✓ validity windows | ✓ always on | ✗ unverified | ★★★★☆ 20K stars |
| **Supermemory** | partial PASS | ✓ hosted MCP | ✗ Scale/Ent only, complex | ✗ OpenAI required [(self-host docs)](https://supermemory.ai/docs/deployment/self-hosting) | ✓ marketing claim | ✗ not documented | partial marketing claim | ✓ app.supermemory.ai | ★★★☆☆ active, smaller |
| **Letta** | ✓/partial PASS | ✗ deprecated MCP [(roadmap)](https://www.letta.com/blog/our-next-phase) | ✓ Apache 2.0, Docker | ✓ Ollama | partial (agent-decided) | partial (sleep-time) | partial (agent-decided) | ✓ ADE | ★★★★☆ 21K stars |
| **Cognee** | ✓ PASS both | ✓ local MCP (v0.3.5+) | ✓ Apache 2.0 | ✓/partial Ollama (unreliable <32B) | ✗ not documented | ✗ not documented | ✓ auto on cognify() | ✓ CLI UI | ★★★☆☆ 14K stars |
| **Claude native** | ✗ FAIL cross-project | — | — | — | — | — | — | ✓ claude.ai | ✓ managed but siloed |
| **ChatGPT native** | ✗ FAIL both | — | — | — | — | — | — | ✓ settings UI | ✓ managed but siloed |

*"partial" = feature exists but with significant caveats; "—" = excluded by hard filter, remainder moot*

---

## Who Wins on Which Axis: Synthesis (~400 words)

### Where off-the-shelf clearly beats a hand-rolled system

**Temporal contradiction resolution** is Zep/Graphiti's uncontested advantage. The bi-temporal validity window — tracking both when a fact was true and when the system learned it — is architecturally non-trivial to build correctly. Lodis's confidence scoring with time-decay is related but not equivalent: Lodis can deprioritize stale facts, while Graphiti can explicitly state "this fact was superseded on date X by this contradicting fact" and maintain the audit history. For any memory system that needs to track evolving state across months (e.g., "user's employer was Acme until March 2026, then became Initech"), Graphiti's approach is genuinely harder to replicate hand-rolled without building the same bi-temporal graph primitives from scratch.

**Ecosystem gravity** is Mem0's advantage. At ~48K stars with native integrations into LangChain, CrewAI, LlamaIndex, and direct AWS Agent provider status, Mem0 provides battle-tested reliability at a scale Lodis cannot match as a personal open-source project. The CLI tooling (`mem0 import`, `--json` flag for agentic pipelines), 9 MCP tools, and the ability to swap to Ollama for zero external spend make Mem0 the fastest path for developers who want something "done."

**Managed infrastructure** is Zep Cloud's advantage: SOC 2 Type II + HIPAA BAA, <200ms P95 retrieval latency, and the ability to handle bursty ingestion without operator capacity planning — none of which an SQLite-backed local server can offer at production scale.

### Where native platform memory would win if it cleared the hard filter

Claude Managed Agents memory stores (beta April 2026) would be the cheapest and most deeply integrated option for a Claude-only workflow. Versioning, redaction, audit trail, and workspace-scoped sharing via REST API are production-grade features. If Anthropic were to expose these stores as a general-purpose cross-project, cross-tool memory API (with MCP access), it would immediately undercut all third-party providers on integration depth and trust. As of May 2026, this has not happened — the hard filter exclusion stands — but it is the single development most worth monitoring.

### Where hand-rolled + zero-LLM-spend is genuinely differentiated

Lodis's most defensible moat is the combination of features **no single off-the-shelf system replicates**: 14 typed entity types, permanence tiers (canonical/active/ephemeral-TTL/archived), PII detection, per-agent permissions, Reciprocal Rank Fusion over hybrid FTS5+vector retrieval, and — most critically — **zero LLM calls on the read/write path**. Every competing system that offers rich auto-extraction (Mem0, Graphiti, Cognee, Supermemory) burns LLM tokens on ingest. Lodis's architectural choice to make extraction caller-supplied or offline means it runs at scale without accruing per-operation costs, making it structurally cheaper for high-frequency agent memory (frequent writes from many concurrent agents) than any hosted alternative. No off-the-shelf system offers a verified zero-LLM-spend ingest path combined with RRF hybrid search and a typed knowledge graph in a single self-contained SQLite-backed server.

---

## Verification Notes

The following claims could not be verified from official documentation and are flagged:

- **Mem0:** Whether imported memories retain original timestamps and confidence scores through the CLI import path is not documented — the `metadata` field may carry these, but behavior is unverified.
- **Supermemory:** Knowledge graph depth, contradiction resolution mechanics, and whether zero-LLM-spend is achievable on self-host are not specified in official API docs; claims appear in marketing/blog content only.
- **Cognee:** Auto-contradiction resolution and time-decay are not documented in the OSS codebase or official docs — only referenced in third-party comparisons.
- **Graphiti dashboard:** No dedicated UI beyond Neo4j's own browser was identified in official Zep/Graphiti documentation.
- **Letta hosted pricing:** Not publicly listed on letta.com as of May 27, 2026.
- **Claude Managed Agents memory stores and non-Claude tool access:** The REST API is documented as open, but no example of a non-Claude tool writing to a Managed Agent memory store was found — behavior with arbitrary HTTP clients is unverified.
- **ChatGPT "project-only memory" isolation:** Multiple user reports from December 2025 note that isolation is imperfect in practice ([Reddit PSA thread](https://www.reddit.com/r/ChatGPT/comments/1plep1s/psa_projectonly_memory_in_chatgpt_projects_is_not/)), despite official documentation claiming strict separation.
