import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { extractSignalTerms } from "../query-extraction.js";

describe("extractSignalTerms", () => {
  const origEnabled = process.env.LODIS_QUERY_EXTRACTION_ENABLED;
  const origDisabled = process.env.LODIS_QUERY_EXTRACTION_DISABLED;

  beforeEach(() => {
    // Default to enabled for most tests; individual tests can override.
    process.env.LODIS_QUERY_EXTRACTION_ENABLED = "1";
    delete process.env.LODIS_QUERY_EXTRACTION_DISABLED;
  });

  afterEach(() => {
    if (origEnabled === undefined) delete process.env.LODIS_QUERY_EXTRACTION_ENABLED;
    else process.env.LODIS_QUERY_EXTRACTION_ENABLED = origEnabled;
    if (origDisabled === undefined) delete process.env.LODIS_QUERY_EXTRACTION_DISABLED;
    else process.env.LODIS_QUERY_EXTRACTION_DISABLED = origDisabled;
  });

  describe("env gating", () => {
    it("returns disabled when LODIS_QUERY_EXTRACTION_ENABLED is unset", () => {
      delete process.env.LODIS_QUERY_EXTRACTION_ENABLED;
      const q = "What is the best Marin County real estate agent for Tiburon";
      const result = extractSignalTerms(q);
      expect(result.mode).toBe("disabled");
      expect(result.effectiveQuery).toBe(q);
    });

    it("returns disabled when LODIS_QUERY_EXTRACTION_DISABLED=1 (even if ENABLED also set)", () => {
      process.env.LODIS_QUERY_EXTRACTION_DISABLED = "1";
      // ENABLED is set by beforeEach; DISABLED should win.
      const q = "What is the best Marin County real estate agent for Tiburon";
      const result = extractSignalTerms(q);
      expect(result.mode).toBe("disabled");
      expect(result.effectiveQuery).toBe(q);
    });
  });

  describe("passthrough for short queries", () => {
    it("returns passthrough for ≤10-token queries", () => {
      const q = "Marin Tiburon Redwood real estate";
      const result = extractSignalTerms(q);
      expect(result.mode).toBe("passthrough");
      expect(result.effectiveQuery).toBe(q);
      expect(result.originalTokens).toBe(5);
    });

    it("returns passthrough for exactly 10 tokens", () => {
      const q = "one two three four five six seven eight nine ten";
      const result = extractSignalTerms(q);
      expect(result.mode).toBe("passthrough");
      expect(result.originalTokens).toBe(10);
    });

    it("runs extraction for 11+ tokens", () => {
      const q = "one two three four five six seven eight nine ten eleven";
      const result = extractSignalTerms(q);
      // 11 tokens triggers extraction; most are short/non-signal so may fallback.
      expect(result.mode).not.toBe("passthrough");
    });
  });

  describe("signal-term extraction", () => {
    it("extracts proper nouns + identifiers + substantive words from a long MRCR question", () => {
      const q =
        "Person_0091 is researching real estate and schools in a specific county. Which county, which specific high school area, and which specific town? Who (by name or role) did he meet with to discuss the real estate market in that area?";
      const result = extractSignalTerms(q);
      expect(result.mode).toBe("keywords");
      // Must retain the rare signal terms.
      expect(result.effectiveQuery).toContain("Person_0091");
      // Substantive (≥6 chars) words kept.
      expect(result.effectiveQuery.toLowerCase()).toMatch(/research(ing)?/);
      expect(result.effectiveQuery.toLowerCase()).toContain("schools");
      // Must NOT retain stopwords.
      expect(result.effectiveQuery.toLowerCase().split(/\s+/)).not.toContain("the");
      expect(result.effectiveQuery.toLowerCase().split(/\s+/)).not.toContain("which");
      expect(result.effectiveQuery.toLowerCase().split(/\s+/)).not.toContain("what");
    });

    it("keeps capitalized proper nouns even if they share a case-folded form with a stopword (drops true stopword forms regardless of case via case-insensitive match)", () => {
      // "Which" at sentence start — normalized lowercase → in STOPWORDS → drop.
      // "Marin" (capitalized, has lowercase) → keep.
      const q =
        "Which Marin Tiburon real estate agent did Person_0091 meet with last November for advice";
      const result = extractSignalTerms(q);
      expect(result.mode).toBe("keywords");
      const tokens = result.effectiveQuery.split(/\s+/);
      expect(tokens).toContain("Marin");
      expect(tokens).toContain("Tiburon");
      expect(tokens).toContain("Person_0091");
      expect(tokens).not.toContain("Which");
    });

    it("keeps ALL-CAPS acronyms of length ≥ 2", () => {
      const q =
        "Does the AI PR strategy for the PM team at the company include an FAQ for sales";
      const result = extractSignalTerms(q);
      expect(result.mode).toBe("keywords");
      const tokens = result.effectiveQuery.split(/\s+/);
      expect(tokens).toContain("AI");
      expect(tokens).toContain("PR");
      expect(tokens).toContain("PM");
      expect(tokens).toContain("FAQ");
    });

    it("keeps tokens containing digits", () => {
      const q =
        "What happened with app_3C7ydyB1 and r_2 versus v_3 during the 2025 release cycle for Person_0091";
      const result = extractSignalTerms(q);
      expect(result.mode).toBe("keywords");
      const tokens = result.effectiveQuery.split(/\s+/);
      expect(tokens).toContain("app_3C7ydyB1");
      expect(tokens).toContain("r_2");
      expect(tokens).toContain("v_3");
      expect(tokens).toContain("2025");
      expect(tokens).toContain("Person_0091");
    });

    it("keeps load-bearing query terms that are NOT stopwords (first/specific/market/role/county/nanny)", () => {
      // Saboteur-3: these must survive because they're load-bearing in normal queries.
      // Default-keep means any non-stopword ≥3 chars survives.
      const q =
        "What is the first specific market role for the person in the county town this year nanny dog trip issue agent";
      const result = extractSignalTerms(q);
      const tokens = result.effectiveQuery.split(/\s+/);
      // Substantive nouns — all survive regardless of length (down to 3 chars).
      expect(tokens).toContain("specific");
      expect(tokens).toContain("market");
      expect(tokens).toContain("person");
      expect(tokens).toContain("county");
      expect(tokens).toContain("first");
      expect(tokens).toContain("role");
      expect(tokens).toContain("town");
      expect(tokens).toContain("year");
      expect(tokens).toContain("nanny");
      expect(tokens).toContain("dog");
      expect(tokens).toContain("trip");
      expect(tokens).toContain("issue");
      expect(tokens).toContain("agent");
    });
  });

  describe("fallback behavior", () => {
    it("falls back to original when extraction yields <3 tokens", () => {
      // All stopwords / short function words — nothing survives.
      const q = "is the of to a an it he she they them their this that these those";
      const result = extractSignalTerms(q);
      expect(result.mode).toBe("fallback");
      expect(result.effectiveQuery).toBe(q);
      expect(result.originalTokens).toBe(16);
    });
  });

  describe("dedup + cap", () => {
    it("deduplicates case-insensitively", () => {
      const q =
        "Marin marin MARIN real estate Tiburon tiburon TIBURON research research research agents Person_0091";
      const result = extractSignalTerms(q);
      expect(result.mode).toBe("keywords");
      const tokens = result.effectiveQuery.split(/\s+/);
      const marinCount = tokens.filter((t) => t.toLowerCase() === "marin").length;
      const tiburonCount = tokens.filter((t) => t.toLowerCase() === "tiburon").length;
      expect(marinCount).toBe(1);
      expect(tiburonCount).toBe(1);
    });

    it("caps retained tokens at 24", () => {
      const tokens: string[] = [];
      for (let i = 0; i < 30; i++) tokens.push(`Proper${i}`);
      // 30 proper nouns — all would be kept, but cap limits to 24.
      const q = tokens.join(" ");
      const result = extractSignalTerms(q);
      expect(result.mode).toBe("keywords");
      expect(result.effectiveQuery.split(/\s+/).length).toBe(24);
    });
  });

  describe("punctuation normalization", () => {
    it("strips trailing commas/periods/question marks", () => {
      const q =
        "Who did Person_0091 meet, for the Marin, real estate, market in November? Really truly";
      const result = extractSignalTerms(q);
      expect(result.mode).toBe("keywords");
      const tokens = result.effectiveQuery.split(/\s+/);
      expect(tokens).toContain("Person_0091");
      expect(tokens).toContain("Marin");
      expect(tokens).toContain("November");
      // Normalized — no "Marin," or "November?" in output.
      expect(tokens.some((t) => t.endsWith(","))).toBe(false);
      expect(tokens.some((t) => t.endsWith("?"))).toBe(false);
    });

    it("preserves internal underscores and slashes", () => {
      const q =
        "Person_0091/Person_0023 Marin Stack Rank for Magda covers many criteria for home search";
      const result = extractSignalTerms(q);
      expect(result.mode).toBe("keywords");
      const tokens = result.effectiveQuery.split(/\s+/);
      expect(tokens).toContain("Person_0091/Person_0023");
    });
  });
});
