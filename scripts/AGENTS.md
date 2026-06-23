# AGENTS.md: scripts/

Inherits the repo root AGENTS.md. One-off Node scripts (`.mjs`) run by hand for benchmarks, retrieval experiments, data migrations, and diagnostics. Not part of the build or the shipped package.

## What's here

Benchmark and A/B harnesses (`stage-*.mjs`, `w1a-*.mjs`, `w2-*.mjs`), data migrations and backfills (`reembed-contextual.mjs`, `*-backfill-*.mjs`, `merge-people-*.mjs`), and verification/diagnostic tools (`verify-*.mjs`, `*-diagnostic.mjs`). Many talk directly to a local or hosted (Turso) database.

## Working rules

- Mutating scripts are destructive by default if run wrong. Keep them dry-run by default and require an explicit `--apply` (and a backup acknowledgement) before they write.
- A script that targets hosted/Turso data touches live private-beta state. That is a James-gated, irreversible action; do not run it unprompted.
- Date-stamp one-shot migrations in the filename so the run history stays legible; leave completed ones in place as a record.
- Read connection target and credentials from the environment, never hardcode them.

## Don't

- Don't wire any of these into CI, the build, or an automated schedule; they are manual by design.
- Don't point a script at production to "just check"; default to local.
- Don't use these to seed or sync James's durable memory; the central substrate owns that (see root AGENTS.md).

## Canonical doc

The repo root `CLAUDE.md` (Repo Structure and Data Directory) and per-script header comments.
