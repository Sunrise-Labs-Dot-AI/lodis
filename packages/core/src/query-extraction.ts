// Query preprocessing for hybrid retrieval.
//
// Problem: long natural-language queries (e.g. 80-word MRCR needle questions)
// dilute the vector embedding and flood FTS5 with common tokens. Rare signal
// terms (`Marin`, `Tiburon`, `Person_0091`) get drowned by common ones
// (`specific`, `county`, `area`, `discuss`). Measured: short query
// "Marin Tiburon Redwood" puts the 3 Marin memories at hybrid ranks 1/2/5;
// the verbatim 80-word question puts them at ranks 18/35/188. Top-3 of the
// long-query hybrid pool are unrelated memories that happen to contain
// `Person_0091`.
//
// Fix: before calling hybridSearch, extract signal terms from long queries.
// Keep original full query for the cross-encoder reranker (it benefits from
// full context). Short queries and env-disabled runs pass through unchanged.
//
// Pure JS — no LLM dependency. Deterministic. <1ms.

export type QueryExtractionMode =
  | "keywords"     // extractor ran and produced ≥3 signal terms
  | "fallback"     // extractor ran but <3 terms survived → use original
  | "passthrough"  // query already short (≤10 tokens) → skip extraction
  | "disabled";    // env var bypass

export interface QueryExtractionResult {
  mode: QueryExtractionMode;
  effectiveQuery: string;
  originalTokens: number;
}

// Standard English stopwords — articles, auxiliaries, pronouns, prepositions,
// common interrogatives. DELIBERATELY excludes:
//
//   (a) Load-bearing query terms: `first/second/third/one/two/three`,
//       `specific/also/any/some/all`, `market/role/person/name/area/county/
//       town/thing/item/part/something` — a real user query might legitimately
//       pivot on any of those.
//
//   (b) Negation + contrastive conjunctions: `not/no/nor/without/except` — per
//       Saboteur-5 in the code-review for PR #84. "What decisions did NOT
//       involve Magda?" would extract to "decisions involve Magda" (semantic
//       INVERSION) if we dropped "not". FTS5 still sees the original query but
//       the dense vec path embeds the extracted short form, so dropping
//       negation flips the retrieved candidate set.
//
// To add a stopword: drop it into this Set in the appropriate row, then
// verify `pnpm --filter @lodis/core test query-extraction` — especially the
// "preserves negation" and "keeps load-bearing query terms" tests which guard
// the two categories above.
const STOPWORDS = new Set([
  // articles / demonstratives
  "the", "a", "an", "this", "that", "these", "those",
  // forms of "be"
  "is", "are", "was", "were", "be", "been", "being", "am",
  // forms of "have"
  "have", "has", "had", "having",
  // forms of "do"
  "do", "does", "did", "done", "doing",
  // modals
  "will", "would", "could", "should", "may", "might", "must", "can", "shall",
  // interrogatives
  "which", "what", "who", "whom", "whose", "when", "where", "why", "how",
  // prepositions (NB: "without" intentionally NOT here — it's negation-like)
  "about", "into", "onto", "upon", "over", "under", "in", "on", "at", "to",
  "from", "with", "within", "through", "across",
  // conjunctions (NB: "not"/"nor"/"but" intentionally NOT here — they flip query semantics)
  "and", "or", "if", "so", "as", "by", "for", "of", "yet",
  // pronouns
  "it", "its", "they", "their", "them", "theirs", "he", "his", "him", "she",
  "her", "hers", "you", "your", "yours", "we", "our", "ours", "us", "me",
  "my", "mine", "i",
  // space / position
  "there", "here",
  // filler
  "just", "very", "really", "also", "even", "only", "still", "already",
]);

const TRAILING_PUNCT = /[,\.;:?!)"'”’]+$/u;
const LEADING_PUNCT = /^[,\.;:?!("'“‘]+/u;

/**
 * Extract signal terms from a user query for hybrid retrieval.
 *
 * Design note on default-keep vs default-drop: earlier iterations dropped
 * medium-length (4–5 char) non-stopword tokens by default. Measurement on
 * MRCR showed this removed load-bearing nouns like "nanny", "realtor",
 * "meet" — query-critical terms that aren't proper nouns. We now default
 * to KEEP for any non-stopword token ≥ 3 chars (with STOPWORDS still
 * catching auxiliaries, articles, pronouns, etc.). The 24-token cap still
 * limits runaway extraction on very long queries.
 *
 * Pipeline (per token, first-match-wins; ordered so stopword check beats
 * capitalization — otherwise sentence-initial "Which"/"Who" would survive):
 *   1. Normalize: trim leading/trailing punctuation. Preserve internal _, /, -.
 *   2. Empty-after-normalize → drop.
 *   3. Lowercase-normalized form is in STOPWORDS → drop.
 *   4. Length < 3 → drop (1–2 char non-stopwords like "eg" — low signal).
 *   5. Otherwise → keep. Substantive nouns, proper nouns, acronyms,
 *      identifiers, numbers all survive.
 *
 * Then:
 *   6. Deduplicate case-insensitively.
 *   7. If <3 tokens survive → return fallback mode (use original query).
 *   8. Cap at 24 retained tokens (tail truncation).
 *   9. Return keywords mode with space-joined retained tokens.
 */
export function extractSignalTerms(query: string): QueryExtractionResult {
  const disabled = process.env.LODIS_QUERY_EXTRACTION_DISABLED === "1";
  const enabled = process.env.LODIS_QUERY_EXTRACTION_ENABLED === "1";
  // v1 default: off. Flip to on after validation.
  // DISABLED wins over ENABLED (matches reranker env semantics — safest reading).
  if (disabled || !enabled) {
    const rawTokens = query.trim().split(/\s+/).filter((t) => t.length > 0);
    return {
      mode: "disabled",
      effectiveQuery: query,
      originalTokens: rawTokens.length,
    };
  }

  const rawTokens = query.trim().split(/\s+/).filter((t) => t.length > 0);
  const originalTokens = rawTokens.length;

  // Passthrough for already-short queries.
  if (originalTokens <= 10) {
    return {
      mode: "passthrough",
      effectiveQuery: query,
      originalTokens,
    };
  }

  const kept: string[] = [];
  const seenLower = new Set<string>();

  for (const raw of rawTokens) {
    // Rule 1: normalize punctuation.
    const normalized = raw.replace(LEADING_PUNCT, "").replace(TRAILING_PUNCT, "");

    // Rule 2: empty-after-normalize → drop.
    if (normalized.length === 0) continue;

    // Rule 3: stopword → drop. Runs FIRST so sentence-initial "Which"/"Who"/etc.
    // are caught before capitalization rules would otherwise keep them. Checked
    // on lowercase-normalized form for case-insensitive matching.
    if (STOPWORDS.has(normalized.toLowerCase())) continue;

    // Rule 4: ALL-CAPS ≥ 2 → keep explicitly. Covers "AI", "PR", "PM", "FAQ",
    // "NBA". Runs before the length check so 2-char acronyms survive.
    if (normalized.length >= 2 && /^[A-Z]+$/.test(normalized)) {
      // keep — fall through to dedup.
    }
    // Rule 5: length < 3 → drop. Catches 1-2 char non-stopword lowercase
    // tokens like "eg" / stray single letters.
    else if (normalized.length < 3) continue;

    // Rule 6: default-keep for any surviving token ≥ 3 chars. Substantive
    // words, proper nouns, identifiers, numbers all pass through.

    // Rule 10: dedup case-insensitively (first spelling wins).
    const key = normalized.toLowerCase();
    if (seenLower.has(key)) continue;
    seenLower.add(key);
    kept.push(normalized);
  }

  // Rule 11: too few survivors → fallback.
  if (kept.length < 3) {
    return {
      mode: "fallback",
      effectiveQuery: query,
      originalTokens,
    };
  }

  // Rule 12: cap at 24.
  const capped = kept.length > 24 ? kept.slice(0, 24) : kept;

  if (process.env.LODIS_QUERY_EXTRACTION_DEBUG === "1") {
    // Emit counts + mode only — NOT the token values. Per Security-5 on PR
    // #84: if this debug var is ever set on a hosted deployment to diagnose a
    // retrieval regression, logs flow to Vercel/Datadog/Sentry where tokens
    // like `Marin`, `Tiburon`, `Person_0091` leak user search intent to
    // operators who have log access but not DB access. Counts alone tell us
    // whether extraction engaged, without exposing content.
    const dropped = rawTokens.length - capped.length;
    // eslint-disable-next-line no-console
    console.error(
      `[lodis] query-extraction: mode=keywords ${originalTokens} tokens → ${capped.length} kept (${dropped} dropped)`,
    );
  }

  return {
    mode: "keywords",
    effectiveQuery: capped.join(" "),
    originalTokens,
  };
}
