import { describe, it, expect } from "vitest";
import {
  CHAPTERS,
  listChapters,
  getChapter,
  isKnownChapterId,
  chapterToMarkdown,
  tocToMarkdown,
} from "../tutorial/index.js";

const MAX_CHAPTER_CHARS = 2500;
const TOOL_NAME_RE = /^memory_[a-z_]+$/;

describe("tutorial — structure", () => {
  it("has at least one chapter", () => {
    expect(CHAPTERS.length).toBeGreaterThan(0);
  });

  it("every chapter id is unique", () => {
    const ids = CHAPTERS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("listChapters returns the full list", () => {
    expect(listChapters().length).toBe(CHAPTERS.length);
  });

  it("getChapter returns matching chapter for each id", () => {
    for (const c of CHAPTERS) {
      expect(getChapter(c.id).id).toBe(c.id);
    }
  });
});

describe("tutorial — chapter length bound (N5)", () => {
  it("every chapter renders to <= 2500 chars", () => {
    for (const c of listChapters()) {
      const md = chapterToMarkdown(getChapter(c.id));
      expect(md.length).toBeLessThanOrEqual(MAX_CHAPTER_CHARS);
      expect(md.length).toBeGreaterThan(0);
    }
  });

  it("tocToMarkdown is non-empty and mentions every chapter id", () => {
    const toc = tocToMarkdown(listChapters());
    expect(toc.length).toBeGreaterThan(0);
    for (const c of listChapters()) {
      expect(toc).toContain(c.id);
    }
  });
});

describe("tutorial — tryItNext safety (Sec1)", () => {
  it("every tryItNext.toolName matches memory_[a-z_]+", () => {
    for (const c of listChapters()) {
      for (const t of c.tryItNext) {
        expect(t.toolName).toMatch(TOOL_NAME_RE);
      }
    }
  });

  it("tryItNext exampleInvocation has no shell metacharacters outside strings", () => {
    for (const c of listChapters()) {
      for (const t of c.tryItNext) {
        if (!t.exampleInvocation) continue;
        // Strip string literals to avoid false positives on ; | ` inside user text
        const stripped = t.exampleInvocation.replace(/"[^"]*"/g, '""');
        expect(stripped).not.toMatch(/[`]/);
        expect(stripped).not.toMatch(/[;]/);
        expect(stripped).not.toMatch(/\|/);
      }
    }
  });

  it("formatter wraps tryItNext in lodis-example fences, not shell/bash/ts", () => {
    for (const c of listChapters()) {
      const md = chapterToMarkdown(getChapter(c.id));
      if (c.tryItNext.some((t) => t.exampleInvocation)) {
        expect(md).toContain("```lodis-example");
      }
      // These fences must never appear inside chapter markdown
      expect(md).not.toContain("```shell");
      expect(md).not.toContain("```bash");
    }
  });
});

describe("tutorial — unknown chapter handling (Sec2)", () => {
  it("isKnownChapterId rejects path-traversal attempts", () => {
    expect(isKnownChapterId("../../etc/passwd")).toBe(false);
    expect(isKnownChapterId("")).toBe(false);
    expect(isKnownChapterId("OVERVIEW")).toBe(false);
    expect(isKnownChapterId("nope")).toBe(false);
  });

  it("isKnownChapterId accepts every declared chapter id", () => {
    for (const c of listChapters()) {
      expect(isKnownChapterId(c.id)).toBe(true);
    }
  });
});

describe("tutorial — content is plain text (Sec5)", () => {
  it("body and codeExample contain no <script or javascript: URIs", () => {
    for (const c of listChapters()) {
      for (const s of c.sections) {
        expect(s.body.toLowerCase()).not.toContain("<script");
        expect(s.body.toLowerCase()).not.toContain("javascript:");
        if (s.codeExample) {
          expect(s.codeExample.toLowerCase()).not.toContain("<script");
          expect(s.codeExample.toLowerCase()).not.toContain("javascript:");
        }
      }
      for (const t of c.tryItNext) {
        expect(t.naturalLanguage.toLowerCase()).not.toContain("<script");
        expect(t.naturalLanguage.toLowerCase()).not.toContain("javascript:");
        if (t.exampleInvocation) {
          expect(t.exampleInvocation.toLowerCase()).not.toContain("<script");
          expect(t.exampleInvocation.toLowerCase()).not.toContain(
            "javascript:",
          );
        }
      }
    }
  });
});
