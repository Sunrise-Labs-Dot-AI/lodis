import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  buildEmbedText,
  legacyEmbedText,
  extractTags,
  embedTextForShape,
  currentEmbeddingShape,
  contextualEmbeddingsEnabled,
} from "../embeddings.js";

// ---------- extractTags ----------
describe("extractTags", () => {
  it("returns [] for null/undefined/empty", () => {
    expect(extractTags(null)).toEqual([]);
    expect(extractTags(undefined)).toEqual([]);
    expect(extractTags("")).toEqual([]);
  });

  it("returns [] for invalid JSON strings", () => {
    expect(extractTags("not-json")).toEqual([]);
    expect(extractTags("{broken")).toEqual([]);
  });

  it("returns [] when tags is absent", () => {
    expect(extractTags({ type: "document" })).toEqual([]);
    expect(extractTags('{"type":"document"}')).toEqual([]);
  });

  it("returns [] when tags is present but not an array", () => {
    expect(extractTags({ tags: "real-estate" })).toEqual([]);
    expect(extractTags({ tags: 42 })).toEqual([]);
    expect(extractTags({ tags: null })).toEqual([]);
  });

  it("filters non-string array elements", () => {
    expect(extractTags({ tags: ["real-estate", 42, null, "marin"] })).toEqual(["real-estate", "marin"]);
  });

  it("sanitizes injection-risk characters", () => {
    expect(extractTags({ tags: ["good\ntag", "with\x1bescape", "{brace}", "[bracket]"] })).toEqual([
      "goodtag",
      "withescape",
      "brace",
      "bracket",
    ]);
  });

  it("drops empty-after-sanitize tags", () => {
    expect(extractTags({ tags: ["   ", "\n", "valid", "{}"] })).toEqual(["valid"]);
  });

  it("caps at 16 tags", () => {
    const many = Array.from({ length: 25 }, (_, i) => `tag${i}`);
    const result = extractTags({ tags: many });
    expect(result.length).toBe(16);
    expect(result[0]).toBe("tag0");
    expect(result[15]).toBe("tag15");
  });

  it("accepts JSON-string structured_data and parses it", () => {
    expect(extractTags('{"tags":["a","b","c"]}')).toEqual(["a", "b", "c"]);
  });

  it("accepts object structured_data directly", () => {
    expect(extractTags({ tags: ["a", "b"] })).toEqual(["a", "b"]);
  });
});

// ---------- buildEmbedText ----------
describe("buildEmbedText", () => {
  it("builds the bracketed-prefix shape with all metadata", () => {
    const result = buildEmbedText({
      content: "Notes from Nov 2025 meeting about Marin County market",
      detail: "Covered pricing, Tiburon vs Mill Valley, seasonal patterns",
      entity_name: "Magda Meeting Notes",
      entity_type: "resource",
      domain: "documents",
      structured_data: { tags: ["real-estate", "marin"] },
    });
    expect(result).toBe(
      "[Magda Meeting Notes] [resource] [documents] [real-estate, marin] " +
      "Notes from Nov 2025 meeting about Marin County market " +
      "Covered pricing, Tiburon vs Mill Valley, seasonal patterns",
    );
  });

  it("omits sections when their source is null/undefined", () => {
    const result = buildEmbedText({
      content: "Some content",
      detail: null,
    });
    expect(result).toBe("Some content");
  });

  it("omits detail but keeps prefix when entity metadata is present", () => {
    const result = buildEmbedText({
      content: "A fact about Sarah Chen",
      detail: null,
      entity_name: "Sarah Chen",
      entity_type: "person",
      domain: "work",
    });
    expect(result).toBe("[Sarah Chen] [person] [work] A fact about Sarah Chen");
  });

  it("omits tag bracket when tags are empty", () => {
    const result = buildEmbedText({
      content: "A fact",
      detail: null,
      entity_name: "Person_0091",
      entity_type: "person",
      domain: "family",
      structured_data: { type: "person" }, // no tags field
    });
    expect(result).toBe("[Person_0091] [person] [family] A fact");
  });

  it("sanitizes brackets/newlines in entity_name (prevents prefix injection)", () => {
    const result = buildEmbedText({
      content: "content",
      detail: null,
      entity_name: "Bad\nName[inject]",
      entity_type: "person",
      domain: "work",
    });
    // Brackets and newline stripped from the entity_name; structure preserved.
    expect(result).toBe("[BadNameinject] [person] [work] content");
  });

  it("returns pure content when called with only content+detail (no metadata)", () => {
    const result = buildEmbedText({
      content: "standalone content",
      detail: "and its detail",
    });
    expect(result).toBe("standalone content and its detail");
  });
});

// ---------- legacyEmbedText ----------
describe("legacyEmbedText", () => {
  it("concatenates content + detail", () => {
    expect(legacyEmbedText({ content: "Hello", detail: "World" })).toBe("Hello World");
  });

  it("returns bare content when detail is null", () => {
    expect(legacyEmbedText({ content: "Hello", detail: null })).toBe("Hello");
  });

  it("ignores metadata fields (legacy shape is content+detail only)", () => {
    expect(
      legacyEmbedText({
        content: "Hello",
        detail: "World",
        entity_name: "Alice",
        entity_type: "person",
        domain: "work",
        structured_data: { tags: ["foo"] },
      }),
    ).toBe("Hello World");
  });
});

// ---------- env gating + currentEmbeddingShape ----------
describe("contextualEmbeddingsEnabled + currentEmbeddingShape", () => {
  const origEnabled = process.env.LODIS_CONTEXTUAL_EMBEDDINGS_ENABLED;
  const origDisabled = process.env.LODIS_CONTEXTUAL_EMBEDDINGS_DISABLED;

  beforeEach(() => {
    delete process.env.LODIS_CONTEXTUAL_EMBEDDINGS_ENABLED;
    delete process.env.LODIS_CONTEXTUAL_EMBEDDINGS_DISABLED;
  });

  afterEach(() => {
    if (origEnabled === undefined) delete process.env.LODIS_CONTEXTUAL_EMBEDDINGS_ENABLED;
    else process.env.LODIS_CONTEXTUAL_EMBEDDINGS_ENABLED = origEnabled;
    if (origDisabled === undefined) delete process.env.LODIS_CONTEXTUAL_EMBEDDINGS_DISABLED;
    else process.env.LODIS_CONTEXTUAL_EMBEDDINGS_DISABLED = origDisabled;
  });

  it("defaults to disabled (returns shape=legacy)", () => {
    expect(contextualEmbeddingsEnabled()).toBe(false);
    expect(currentEmbeddingShape()).toBe("legacy");
  });

  it("ENABLED=1 turns it on", () => {
    process.env.LODIS_CONTEXTUAL_EMBEDDINGS_ENABLED = "1";
    expect(contextualEmbeddingsEnabled()).toBe(true);
    expect(currentEmbeddingShape()).toBe("v1-bracketed");
  });

  it("DISABLED=1 wins over ENABLED=1 (matches reranker env pattern)", () => {
    process.env.LODIS_CONTEXTUAL_EMBEDDINGS_ENABLED = "1";
    process.env.LODIS_CONTEXTUAL_EMBEDDINGS_DISABLED = "1";
    expect(contextualEmbeddingsEnabled()).toBe(false);
    expect(currentEmbeddingShape()).toBe("legacy");
  });
});

// ---------- embedTextForShape ----------
describe("embedTextForShape", () => {
  it("routes to legacyEmbedText for shape='legacy'", () => {
    const result = embedTextForShape("legacy", {
      content: "Hello",
      detail: "World",
      entity_name: "Alice",
      domain: "work",
    });
    expect(result).toBe("Hello World");
  });

  it("routes to buildEmbedText for shape='v1-bracketed'", () => {
    const result = embedTextForShape("v1-bracketed", {
      content: "Hello",
      detail: "World",
      entity_name: "Alice",
      domain: "work",
    });
    expect(result).toBe("[Alice] [work] Hello World");
  });
});
