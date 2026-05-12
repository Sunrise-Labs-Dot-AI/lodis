#!/usr/bin/env node
// One-shot audit: spin up the McpServer in-process, list tools, and flag
// every Codex-incompatible JSON Schema feature per tool.
//
// Codex (OpenAI Responses API function-calling strict-mode subset) rejects:
//   - "type": "integer"
//   - "oneOf" / "anyOf" / "allOf"
//   - "$ref"
//   - missing "type" on object/array nodes
//   - empty properties (parameter-less tool) — separate runtime crash
//   - additionalProperties expressed as a schema (e.g. z.record) — needs to be
//     boolean false or absent
//
// We walk every inputSchema and tag the offenders.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
const mcpServerDir = path.resolve(import.meta.dirname ?? ".", "..", "packages", "mcp-server");
const localRequire = createRequire(path.join(mcpServerDir, "package.json"));
// Resolve a known sub-path file, then walk back to the package root. The
// package's exports map blocks reading package.json directly.
const knownFile = localRequire.resolve("@modelcontextprotocol/sdk/server/mcp.js");
const sdkRoot = knownFile.split(path.sep + "dist" + path.sep)[0];
const { Client } = await import(path.join(sdkRoot, "dist", "esm", "client", "index.js"));
const { InMemoryTransport } = await import(path.join(sdkRoot, "dist", "esm", "inMemory.js"));
const { startServer } = await import(path.join(mcpServerDir, "dist", "index.js"));

const tmp = mkdtempSync(path.join(tmpdir(), "lodis-audit-"));
const dbUrl = "file:" + path.join(tmp, "lodis.db");

const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
const { server } = await startServer({
  transport: serverTransport,
  dbUrl,
  skipEmbeddings: true,
});

const client = new Client({ name: "audit-tool", version: "0.0.0" }, { capabilities: {} });
await client.connect(clientTransport);

const { tools } = await client.listTools();

function* walk(node) {
  if (node === null || typeof node !== "object") return;
  yield node;
  for (const v of Object.values(node)) {
    if (v && typeof v === "object") yield* walk(v);
  }
}

function audit(schema) {
  const flags = new Set();
  if (!schema || typeof schema !== "object") return { flags, properties: 0 };
  for (const node of walk(schema)) {
    if (node.type === "integer") flags.add("integer");
    if (Array.isArray(node.oneOf)) flags.add("oneOf");
    if (Array.isArray(node.anyOf)) flags.add("anyOf");
    if (Array.isArray(node.allOf)) flags.add("allOf");
    if (typeof node.$ref === "string") flags.add("$ref");
    if (node.default !== undefined) flags.add("default");
    if (
      node.type === "object" &&
      node.additionalProperties &&
      typeof node.additionalProperties === "object" &&
      // additionalProperties: {} (empty schema, no `type`) trips Codex's
      // parser. additionalProperties: true is fine — see emptyProperties
      // note below for the analogous root-level case.
      Object.keys(node.additionalProperties).length === 0
    ) {
      flags.add("openAdditionalProps");
    }
  }
  // emptyProperties is a tool-root-only concern. Codex crashes on a
  // top-level inputSchema with `properties: {}` (parameter-less tools).
  // Nested objects with `properties: {}` are fine — they describe
  // "free-form object with no required keys" and Codex parses them.
  if (
    schema.type === "object" &&
    schema.properties &&
    Object.keys(schema.properties).length === 0
  ) {
    flags.add("emptyRootProperties");
  }
  const props = schema.properties ? Object.keys(schema.properties).length : 0;
  return { flags, properties: props };
}

const rows = tools
  .map((t) => {
    const a = audit(t.inputSchema);
    const descLen = (t.description ?? "").length;
    const schemaLen = JSON.stringify(t.inputSchema ?? {}).length;
    return {
      name: t.name,
      props: a.properties,
      descLen,
      schemaLen,
      flags: [...a.flags].sort().join(",") || "—",
    };
  })
  .sort((a, b) => a.name.localeCompare(b.name));

const maxName = Math.max(...rows.map((r) => r.name.length));
console.log(`Total tools: ${rows.length}\n`);
console.log("name".padEnd(maxName), " props  descLen  schemaLen  flags");
console.log("-".repeat(maxName + 50));
for (const r of rows) {
  console.log(
    r.name.padEnd(maxName),
    r.props.toString().padStart(5),
    r.descLen.toString().padStart(8),
    r.schemaLen.toString().padStart(10),
    "  ",
    r.flags,
  );
}

const totalDesc = rows.reduce((s, r) => s + r.descLen, 0);
const totalSchema = rows.reduce((s, r) => s + r.schemaLen, 0);
console.log(`\nAggregate description chars: ${totalDesc}`);
console.log(`Aggregate schema JSON chars: ${totalSchema}`);
console.log(`Sum total (rough payload size): ${totalDesc + totalSchema}`);

// Tally every JSON Schema keyword used across all tools — helps spot
// unexpected attributes (format, pattern, minItems, etc.) that Codex's
// stricter parser might reject.
const keywordCounts = new Map();
const typeKindCounts = new Map();
for (const t of tools) {
  for (const node of walk(t.inputSchema)) {
    for (const k of Object.keys(node)) keywordCounts.set(k, (keywordCounts.get(k) ?? 0) + 1);
    if (typeof node.type === "string") {
      typeKindCounts.set(node.type, (typeKindCounts.get(node.type) ?? 0) + 1);
    } else if (Array.isArray(node.type)) {
      typeKindCounts.set("(array-type)", (typeKindCounts.get("(array-type)") ?? 0) + 1);
    }
  }
}
console.log("\nAll JSON Schema keywords seen (count):");
[...keywordCounts.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${k}: ${v}`));
console.log("\nAll `type` values seen (count):");
[...typeKindCounts.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${k}: ${v}`));

// Specifically check the user-reported "working in Codex" set vs the rest.
const REPORTED_WORKING = new Set(["memory_search", "memory_index", "memory_get", "memory_rate_context", "memory_context", "memory_onboard"]);
console.log("\nReported-working tools vs. heuristic flags:");
for (const r of rows.filter((r) => REPORTED_WORKING.has(r.name))) {
  console.log(`  ✓ ${r.name.padEnd(maxName)} flags=${r.flags}`);
}
console.log("\nReported-NOT-working tools that ALSO look clean by our heuristic (mystery group):");
for (const r of rows.filter((r) => !REPORTED_WORKING.has(r.name) && r.flags === "—")) {
  console.log(`  ? ${r.name.padEnd(maxName)} props=${r.props} descLen=${r.descLen}`);
}

const clean = rows.filter((r) => r.flags === "—").map((r) => r.name);
console.log(`\nCodex-compatible (no incompatible features): ${clean.length}`);
clean.forEach((n) => console.log("  " + n));

const incompatible = rows.filter((r) => r.flags !== "—");
console.log(`\nCodex-incompatible: ${incompatible.length}`);

// Dump representative schemas for cross-check against Codex's actual filter.
const dump = process.argv.slice(2);
if (dump.length > 0) {
  console.log("\n--- requested schemas ---");
  for (const name of dump) {
    const t = tools.find((x) => x.name === name);
    if (!t) {
      console.log(`(no such tool: ${name})`);
      continue;
    }
    console.log(`\n# ${name}`);
    console.log(JSON.stringify(t.inputSchema, null, 2));
  }
}

await client.close();
process.exit(0);
