// Re-add the local `lodis` MCP server to Claude Desktop's config.
//
// WHY A SCRIPT (not a Claude edit): Claude Desktop stores its `preferences` blob
// in the SAME claude_desktop_config.json, so it rewrites the whole file on quit
// and clobbers any entry added while it was running. This must be applied while
// Desktop is FULLY QUIT. Run it from a real Terminal (Terminal.app / iTerm),
// NOT from inside a Desktop-hosted session.
//
// Sequence:
//   1. Quit Claude Desktop  (Cmd+Q — confirm it's gone from the Dock)
//   2. node ~/Documents/Claude/Projects/lodis/scripts/add-lodis-to-desktop.mjs
//   3. Relaunch Claude Desktop  → the mcp__lodis__* tools appear
//
// Idempotent: safe to re-run. Self-guards: refuses to run if Desktop is up.

import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const cfgPath = path.join(os.homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json");

// --- Guard: refuse while the Desktop GUI is running (it would clobber this on next quit) ---
// NB: `pgrep` can miss the GUI process in some sandboxed contexts; `ps | grep` is reliable.
const running = execSync('ps aux | grep -F "/Applications/Claude.app/Contents/MacOS/Claude" | grep -v grep || true', { encoding: "utf8" }).trim();
if (running) {
  console.error("✗ Claude Desktop appears to be RUNNING. Fully quit it first (Cmd+Q, confirm it's gone");
  console.error("  from the Dock), then re-run this from a real Terminal (not inside Desktop).");
  process.exit(1);
}

if (!fs.existsSync(cfgPath)) {
  console.error("✗ Config not found:", cfgPath);
  process.exit(1);
}

// --- Back up, then add the entry (JSON parse/stringify preserves everything incl. preferences) ---
const raw = fs.readFileSync(cfgPath, "utf8");
fs.writeFileSync(cfgPath + ".bak-" + new Date().toISOString().replace(/[:.]/g, "-"), raw);
const cfg = JSON.parse(raw);
cfg.mcpServers = cfg.mcpServers || {};
cfg.mcpServers.lodis = {
  command: "/opt/homebrew/bin/node",
  args: ["/Users/jamesheath/Documents/Claude/Projects/lodis/packages/mcp-server/dist/cli.js"],
  env: { LODIS_RERANKER_MODEL: "Xenova/ms-marco-MiniLM-L-6-v2" },
};
fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));

// --- Validate the write ---
JSON.parse(fs.readFileSync(cfgPath, "utf8"));
console.log("✓ Added 'lodis'. mcpServers now: " + Object.keys(cfg.mcpServers).join(", "));
console.log("✓ Config is valid JSON. Now relaunch Claude Desktop — mcp__lodis__* tools should appear.");
