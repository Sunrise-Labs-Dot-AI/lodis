# AGENTS.md: packages/mcp-server/

Inherits the repo root AGENTS.md. This is `@sunriselabs/lodis`, the published npm package: the MCP server and CLI that every client (Claude Code, Cursor, Windsurf, Cline) connects to. The product's front door.

## What's here

`cli.ts` (npx entry), `server.ts` + `index.ts` (the ~40 MCP tools), `http.ts` / `serverless.ts` / `cloud.ts` (transport variants), `auth.ts`. Tests in `__tests__/`. Tool surface and behavior are imported from `@lodis/core`; this package wires them to MCP and stdio.

## Working rules

- The public contract is the tool surface and stdio protocol. Renaming, removing, or changing the shape of a tool is a breaking change for installed clients; treat it as such.
- This package is published to npm. Version and changelog deliberately; publish is a manual, James-gated step, never automated from an agent run.
- Keep transport variants (stdio, http, serverless, cloud) behaviorally aligned; a fix in one usually belongs in the others.
- Error messages are user-facing and must be actionable.

## Don't

- Don't `console.log` on production paths; it corrupts the stdio MCP stream.
- Don't bake secrets or a hosted URL into the package. Deeplink and host resolve from env (`LODIS_DASHBOARD_URL`, etc.).
- Don't add a tool that makes Lodis the durable system of record for James's memory; that role moved to the central substrate (see root AGENTS.md).

## Canonical doc

`packages/mcp-server/README.md` and the MCP Tools section of the repo root `CLAUDE.md`.
