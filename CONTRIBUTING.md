# Contributing to Lodis

Thanks for your interest in contributing to Lodis! This document covers the process for contributing to this project.

## Developer Certificate of Origin (DCO)

All contributions must be signed off under the [Developer Certificate of Origin](https://developercertificate.org/) (DCO). This certifies that you have the right to submit the work under the project's MIT license.

Add a sign-off to your commits:

```
git commit -s -m "feat: add new feature"
```

This adds a `Signed-off-by: Your Name <your@email.com>` line to the commit message, using your git `user.name` and `user.email`.

## Getting Started

```bash
# Clone the repo
git clone https://github.com/Sunrise-Labs-Dot-AI/lodis.git
cd lodis

# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test
```

## Project Structure

```
packages/
  core/         # Schema, types, confidence engine, LLM abstraction
  mcp-server/   # MCP server + CLI entry point (published to npm)
  dashboard/    # Next.js localhost dashboard
  landing/      # lodis.ai landing page
```

## Branch Conventions

- `feat/` — new features
- `fix/` — bug fixes
- `chore/` — maintenance, dependencies, tooling

## Code Standards

- TypeScript strict mode — no `any` types
- Database queries through Drizzle ORM (no raw SQL except FTS5/sqlite-vec setup)
- All timestamps as ISO 8601 strings
- All IDs as `hex(randomblob(16))`
- Tests with Vitest

## Pull Requests

- One feature or fix per PR
- Include tests for new functionality
- Ensure `pnpm test` passes before submitting
- Write a clear description of what changed and why

## Releases (npm publish)

Only `packages/mcp-server` is published to npm (as `lodis-mcp`). All other workspace packages are private or internal-only.

```bash
# 1. From the repo root, build and test everything
pnpm install
pnpm build
pnpm test

# 2. Bump the mcp-server version (semver-aware)
cd packages/mcp-server
npm version minor --no-git-tag-version    # patch / minor / major as appropriate

# 3. Dry-run the publish to inspect tarball contents
npm publish --dry-run

# 4. Publish (requires npm auth + 2FA)
npm publish --access public

# 5. Tag the release in git, from the repo root
cd ../..
VERSION=$(node -p "require('./packages/mcp-server/package.json').version")
git tag "v$VERSION" && git push origin "v$VERSION"
```

When adding a new MCP tool: bump the minor version, update the tool table in both `README.md` (root) and `packages/mcp-server/README.md` (npm-facing), and update the tool count.

The deprecated `engrams` package on npm is frozen at v0.5.1 and should not receive further updates — `lodis` is the canonical name as of v0.6.0.

## Reporting Issues

Use [GitHub Issues](https://github.com/Sunrise-Labs-Dot-AI/lodis/issues) for bugs and feature requests. For security vulnerabilities, see [SECURITY.md](SECURITY.md).
