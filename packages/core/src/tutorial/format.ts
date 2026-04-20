import type { Chapter, ChapterFormat } from "./types.js";

export function tocToMarkdown(chapters: Chapter[]): string {
  const lines: string[] = [];
  lines.push("# Lodis tutorial\n");
  lines.push("Call `memory_tutorial({ chapter: \"<id>\" })` to walk through any chapter. Narrate the examples — do not auto-run them.\n");
  lines.push("| id | title | one-liner |");
  lines.push("| --- | --- | --- |");
  for (const c of chapters) {
    lines.push(`| \`${c.id}\` | ${c.title} | ${c.oneLiner} |`);
  }
  if (chapters.length > 0) {
    const order = chapters.map((c) => `\`${c.id}\``).join(" → ");
    lines.push("");
    lines.push(`Recommended order: ${order}`);
  }
  return lines.join("\n");
}

export function chapterToMarkdown(chapter: Chapter, format: ChapterFormat = "narrative"): string {
  const lines: string[] = [];
  lines.push(`# ${chapter.title}\n`);
  lines.push(`_${chapter.oneLiner}_\n`);

  for (const section of chapter.sections) {
    lines.push(`## ${section.heading}\n`);
    lines.push(section.body);
    if (section.codeExample) {
      lines.push("");
      lines.push("```");
      lines.push(section.codeExample);
      lines.push("```");
    }
    lines.push("");
  }

  if (chapter.tools.length > 0) {
    lines.push("## Tools in this chapter\n");
    for (const tool of chapter.tools) {
      lines.push(`- **\`${tool.name}\`** — ${tool.blurb}`);
      if (tool.example && format === "reference") {
        lines.push(`  - Example: \`${tool.example}\``);
      }
    }
    lines.push("");
  }

  if (chapter.tryItNext.length > 0) {
    lines.push("## Examples (for you to try — do not auto-run)\n");
    lines.push("Narrate these to the user and ask before running any of them.\n");
    for (const next of chapter.tryItNext) {
      lines.push(`- ${next.naturalLanguage} (uses \`${next.toolName}\`)`);
      if (next.exampleInvocation) {
        lines.push("");
        lines.push("```lodis-example");
        lines.push(next.exampleInvocation);
        lines.push("```");
      }
    }
    lines.push("");
  }

  return lines.join("\n").trim();
}
