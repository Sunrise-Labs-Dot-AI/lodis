// Experiment B: can a calling agent correctly choose the `supersede` resolution?
// Uses local Ollama (qwen2.5:14b) as the agent — a strict LOWER BOUND vs Claude.
// For each labeled (existing, new) pair we present the EXACT similar_found options
// the real memory_write tool returns, and check which resolution the model picks.
//
// Metric focus: supersede precision/recall + the dangerous confusions
// (state-change misread as `correct` → loses history; or `keep_both` → both stay valid).
//
// Run: node scripts/sim-supersede-agent.mjs   (Ollama must be up on :11434)

const OLLAMA = "http://localhost:11434/api/chat";
const MODEL = "qwen2.5:14b";

const OPTIONS = [
  "update — replace the existing memory's content with the new content (same fact, refined wording)",
  "correct — the existing memory was FACTUALLY WRONG; fix the error and boost confidence",
  "supersede — the world CHANGED (a role/status/location/value transition); the old fact was true THEN but is stale NOW — preserve it as history and store the new one as current",
  "add_detail — the new text ADDS detail to the same fact; append it",
  "keep_both — the new fact is INDEPENDENT and can coexist with the existing one; store separately",
  "skip — the existing memory already captures this; write nothing",
];

// label = the single best resolution. refinement accepts update|add_detail.
const SCENARIOS = [
  // state change -> supersede
  ["supersede", "James works at Acme as a PM.", "James now works at Initech as a Director of Product."],
  ["supersede", "James lives in New York City.", "James moved to Austin, Texas last month."],
  ["supersede", "The project deadline is March 15.", "The project deadline was pushed to April 30."],
  ["supersede", "James's primary code editor is Vim.", "James switched to VS Code as his main editor."],
  ["supersede", "James is single.", "James got married in June 2026."],
  ["supersede", "The team uses Jira for tracking.", "The team migrated to Linear for issue tracking."],
  // factual error -> correct
  ["correct", "James was born in 1990.", "Correction: James was born in 1991 — the 1990 was a typo."],
  ["correct", "James's email is james@acme.com.", "James's email is actually james.heath@gmail.com; the acme address was never correct."],
  ["correct", "The meeting is in Room 204.", "The meeting is in Room 240 — I transposed the digits earlier."],
  // duplicate -> skip
  ["skip", "James prefers concise summaries.", "James prefers concise summaries."],
  ["skip", "James drinks coffee every morning.", "James has coffee each morning."],
  // independent fact -> keep_both
  ["keep_both", "James works at Acme.", "James has a golden retriever named Max."],
  ["keep_both", "James likes coffee.", "James enjoys hiking on weekends."],
  // refinement -> update|add_detail
  ["refine", "James is a product manager.", "James is a senior product manager on the platform infrastructure team."],
  ["refine", "The API rate limit is 100 req/min.", "The API rate limit is 100 req/min per key, bursting to 150."],
];

const VALID = ["update", "correct", "supersede", "add_detail", "keep_both", "skip"];

function isCorrect(label, pick) {
  if (label === "refine") return pick === "update" || pick === "add_detail";
  return pick === label;
}

async function ask(existing, neu) {
  const sys = "You are an agent managing a user's long-term memory. When you try to store a fact and a similar one already exists, you must choose exactly one resolution. Respond ONLY as JSON: {\"resolution\": <one of update|correct|supersede|add_detail|keep_both|skip>, \"reason\": <brief>}.";
  const user = `EXISTING memory:\n"${existing}"\n\nNEW fact you are trying to store:\n"${neu}"\n\nResolution options:\n${OPTIONS.map((o) => "- " + o).join("\n")}\n\nWhich single resolution best fits? JSON only.`;
  const res = await fetch(OLLAMA, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "system", content: sys }, { role: "user", content: user }],
      stream: false,
      format: "json",
      options: { temperature: 0.1 },
    }),
  });
  const j = await res.json();
  let pick = "(parse-fail)";
  try {
    const parsed = JSON.parse(j.message.content);
    pick = String(parsed.resolution || "").toLowerCase().trim();
  } catch { /* leave parse-fail */ }
  return VALID.includes(pick) ? pick : (pick || "(empty)");
}

const results = [];
let correct = 0;
for (const [label, existing, neu] of SCENARIOS) {
  const pick = await ask(existing, neu);
  const ok = isCorrect(label, pick);
  if (ok) correct++;
  results.push({ label, pick, ok, neu: neu.slice(0, 48) });
  process.stderr.write(`${ok ? "✓" : "✗"} want=${label.padEnd(10)} got=${String(pick).padEnd(11)} | ${neu.slice(0, 50)}\n`);
}

// Supersede precision/recall.
const supTrue = results.filter((r) => r.label === "supersede");
const supPicked = results.filter((r) => r.pick === "supersede");
const supTP = supPicked.filter((r) => r.label === "supersede").length;
const recall = supTrue.length ? supTP / supTrue.length : 0;
const precision = supPicked.length ? supTP / supPicked.length : 0;

// Dangerous confusions: a real state-change picked as something that loses history/pollutes.
const dangerous = supTrue.filter((r) => r.pick !== "supersede").map((r) => `${r.neu} -> ${r.pick}`);

console.log("\n==== Experiment B: agent resolution choice (qwen2.5:14b) ====");
console.log(`overall accuracy: ${correct}/${SCENARIOS.length} = ${(100 * correct / SCENARIOS.length).toFixed(0)}%`);
console.log(`supersede recall:    ${supTP}/${supTrue.length} (${(100 * recall).toFixed(0)}%) — of true state-changes, picked supersede`);
console.log(`supersede precision: ${supTP}/${supPicked.length} (${(100 * precision).toFixed(0)}%) — of supersede picks, truly state-changes`);
console.log(`state-changes NOT caught as supersede:`);
for (const d of dangerous) console.log("   - " + d);
