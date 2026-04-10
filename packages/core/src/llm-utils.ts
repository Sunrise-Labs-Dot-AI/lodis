/**
 * Parse JSON from LLM response, stripping markdown code fences and
 * any trailing text after the JSON object/array.
 */
export function parseLLMJson<T = unknown>(text: string): T {
  const cleaned = text
    .replace(/^```(?:json)?\s*\n?/i, "")
    .replace(/\n?```\s*$/i, "")
    .trim();

  // Try direct parse first (fast path)
  try {
    return JSON.parse(cleaned);
  } catch {
    // LLM may have appended text after valid JSON — extract just the JSON
    const start = cleaned.indexOf("{");
    const arrStart = cleaned.indexOf("[");
    const jsonStart =
      start === -1 ? arrStart : arrStart === -1 ? start : Math.min(start, arrStart);

    if (jsonStart === -1) {
      throw new Error(`No JSON object or array found in LLM response`);
    }

    const open = cleaned[jsonStart];
    const close = open === "{" ? "}" : "]";
    let depth = 0;
    let inString = false;
    let escape = false;

    for (let i = jsonStart; i < cleaned.length; i++) {
      const ch = cleaned[i];
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (ch === open) depth++;
      else if (ch === close) {
        depth--;
        if (depth === 0) {
          return JSON.parse(cleaned.slice(jsonStart, i + 1));
        }
      }
    }

    // Fallback: throw with original error context
    return JSON.parse(cleaned);
  }
}
