# AGENTS.md: packages/dashboard/

Inherits the repo root AGENTS.md. `@lodis/dashboard` is the Next.js 15 control surface for browsing, searching, and correcting memories, plus the hosted `/api/mcp` route. Runs at localhost:3838 locally and deploys to Vercel for hosted beta.

## What's here

App Router under `src/app/` (memory, entities, agents, archive, retrievals, documents, settings, sign-in/up, plus `api/mcp`, `api/oauth`, `api/import|export|migrate`), `components/`, `lib/`, `middleware.ts`. Clerk auth on hosted. Build config in `vercel.json`, `next.config.mjs`.

## Working rules

- Merging to the default branch can trigger a Vercel production deploy of this package. Confirm the deploy posture before any self-merge; a building deploy check means stop and leave it to James.
- The hosted `api/mcp/route.ts` is the serverless twin of the stdio server. Keep it aligned with `packages/mcp-server`, and respect its `maxDuration` and bundled onnxruntime config in `vercel.json`.
- Enforce permissions and auth (`middleware.ts`, Clerk) on every read and write path. Deny by default.
- Use `@lodis/shared-ui` tokens and CSS custom properties for color; do not hardcode palette values.

## Don't

- Don't render stored memory content as trusted or as markup that could execute; it is untrusted user data.
- Don't loosen auth, CORS, or the OAuth `.well-known` routes to make local dev easier.
- Don't introduce changes that expand the hosted footprint; the product direction is local-first and this surface is being wound down.

## Canonical doc

The Dashboard and Design System (Pensieve) sections of the repo root `CLAUDE.md`.
