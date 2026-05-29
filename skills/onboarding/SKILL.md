---
name: onboarding
description: Use the first time a user sets up Lodis, or when they ask to "set up Lodis", "get started with memory", "onboard", or "seed my memory". Orchestrates `memory_onboard` (configure the agent to prefer Lodis, scan connected tools, interview the user, seed memories) and then `memory_interview` to clean up and fill gaps. Also use when a user with a sparse or messy memory store asks to improve it.
---

# Lodis — Onboarding

You have access to the Lodis MCP tools. This skill turns an empty (or thin) memory store into a useful one. The #1 reason Lodis underdelivers for new users is that **agents don't reach for it by default** — so the first job is to fix that, then seed real memories.

## Step 0 — Make yourself prefer Lodis (do this first, once)

`memory_onboard` returns a plan whose Phase 0 asks you to add a memory instruction to the host agent's global config so future sessions actually use Lodis. Honor it:
- For **Claude Code**: add a short rule to `~/.claude/CLAUDE.md` (or the project `CLAUDE.md`) such as: *"Use Lodis MCP tools for persistent memory: `memory_context` at session start, `memory_write` when you learn something durable."*
- For **Cursor**: the equivalent line in `.cursor/rules` / `.cursorrules`.
- Tell the user you've done this and why (so memory works without them asking each time). Don't write config files without making the change visible to the user.

## Step 1 — Call `memory_onboard`

Pass the tools you can actually see in this session so the scan is tailored:
```
memory_onboard({ available_tools: ["gcal", "gmail", "github", "slack", "notion"] })
```
Optional flags: `skip_scan: true` (jump to the interview) or `skip_interview: true` (scan only). The tool returns a markdown plan in three phases:
- **Phase 0** — the agent-config step (Step 0 above).
- **Phase 1 — silent scan.** Walk the user's connected tools and extract durable facts: recurring calendar meetings → people/projects, frequent email contacts → people, GitHub repos → projects, etc. Write each via `memory_write` with `sourceType: "inferred"` and a `sourceDescription` naming the tool it came from. Supply `entityType` + `entityName`. Keep it silent — don't narrate every write; summarize at the end.
- **Phase 2 — interview.** Ask the user targeted questions to enrich what the scan found (relationships, priorities, working style, project context). Write answers as `stated` memories.

Aim to seed ~30–50 high-quality memories, typed and connected — not hundreds of low-value rows.

## Step 2 — Clean up and fill gaps with `memory_interview`

Once there's a base (now, or on a later session for an existing store), call:
```
memory_interview({ focus: "both", max_questions: 15 })
```
Optional filters: `domain`, `entity_type`, `entity_name`; `focus` can be `cleanup` | `gaps` | `both`. It returns a markdown plan with prioritized cleanup items (PII exposure, expired ephemerals, contradictions, low-confidence/corrected rows, stale unused rows) and gap-fill questions. Work the plan:
- Cleanup → `memory_scrub` (PII), `memory_correct` (wrong content), `memory_remove` (obsolete), `memory_confirm` (verified correct), `memory_pin` (canonical), `memory_archive` (keep but deprioritize), `memory_split` (compound rows).
- Gaps → ask the user, then `memory_write` the answers.
Resolve cleanup items conversationally — one user answer can drive one tool call. Lodis stores the audited result; the judgment is yours.

## Step 3 — Confirm and hand off to the dashboard

Tell the user they can review everything at the dashboard (`http://localhost:3838` by default — every memory in tool responses carries a `url`). Encourage them to confirm what's right and correct what's wrong; those signals tune confidence and retrieval.

## Notes

- All extraction and judgment happen on your side — Lodis runs no LLM on read or write. The tools hand you a plan; you execute it.
- Don't seed speculative or low-confidence facts just to hit a count. A small, accurate, well-typed store retrieves better than a large noisy one.
