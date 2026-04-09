/**
 * Parse JSON from LLM response, stripping markdown code fences if present.
 */
export function parseLLMJson<T = unknown>(text: string): T {
  const cleaned = text
    .replace(/^```(?:json)?\s*\n?/i, "")
    .replace(/\n?```\s*$/i, "")
    .trim();
  return JSON.parse(cleaned);
}
