import type { EntityType } from "./types.js";
import type { LLMProvider } from "./llm.js";
import { parseLLMJson } from "./llm-utils.js";

export interface ExtractionResult {
  entity_type: EntityType;
  entity_name: string | null;
  structured_data: Record<string, unknown>;
  summary: string | null;
  suggested_connections: {
    target_entity_name: string;
    target_entity_type: string;
    relationship: string;
  }[];
}

export async function extractEntity(
  provider: LLMProvider,
  content: string,
  detail: string | null,
  existingEntityNames?: string[],
): Promise<ExtractionResult> {
  const existingNamesHint = existingEntityNames && existingEntityNames.length > 0
    ? `\n\nExisting entity names in the system (prefer matching these over creating new ones):\n${existingEntityNames.slice(0, 50).map((n) => `- ${n}`).join("\n")}`
    : "";

  // Truncate very long inputs to avoid token budget issues
  const truncatedDetail = detail && detail.length > 1000 ? detail.slice(0, 1000) + "..." : detail;

  const prompt = `Classify this memory and extract structured data.

Memory: ${content}${truncatedDetail ? `\nDetail: ${truncatedDetail}` : ""}${existingNamesHint}

Respond with JSON only:
{
  "entity_type": "person|organization|place|project|preference|event|goal|fact|lesson|routine|skill|resource|decision",
  "entity_name": "canonical name or null if not applicable",
  "summary": "one-line summary under 15 words capturing the key point",
  "structured_data": { type-specific fields },
  "suggested_connections": [
    { "target_entity_name": "...", "target_entity_type": "...", "relationship": "works_at|involves|located_at|part_of|about|related|informed_by|uses" }
  ]
}

Entity type definitions (choose the BEST fit):
- person: about a specific individual. Name, role, relationship to user.
- organization: about a company, team, or group.
- place: about a location.
- project: about a work project or initiative. NOT a tool (use resource).
- preference: what the user likes/dislikes/prefers. NOT a habit (use routine).
- event: something that happened or will happen at a specific time. NOT recurring (use routine).
- goal: something the user wants to achieve in the future. NOT something already learned (use lesson).
- fact: general knowledge or factual info. NOT a learning from experience (use lesson).
- lesson: something learned from experience — has a "because" or story behind it. NOT a bare fact.
- routine: a recurring behavior, habit, or workflow the user follows regularly. NOT a one-time event.
- skill: a proficiency or expertise area the user has. NOT a preference.
- resource: an external tool, service, document, or URL the user uses. NOT a project. Documents indexed from external sources (Drive, Notion, filesystem) are stored as resources with type: 'document' in structured_data.
- decision: a specific choice the user made, with reasoning. NOT an event (focuses on rationale, not timing).

For entity_name, use the canonical form (e.g. "Sarah Chen" not "my manager Sarah"). If an existing entity name matches, use that exact spelling.

For structured_data, include relevant fields:
- person: name, role, organization, relationship_to_user
- organization: name, type, user_relationship
- place: name, context
- project: name, status, user_role
- preference: category, strength (strong/mild/contextual)
- event: what, when, who
- goal: what, timeline, status (active/achieved/abandoned)
- fact: category
- lesson: topic, context, source (experience/observation/advice)
- routine: activity, frequency, status (active/lapsed/aspirational)
- skill: domain, level (beginner/intermediate/advanced/expert), context
- resource: name, type (tool/service/document/url/book/other), url, purpose
- decision: what, rationale, alternatives, when, status (active/revisiting/reversed)`;

  const text = await provider.complete(prompt, { maxTokens: 2048, json: true });
  let result = parseLLMJson<ExtractionResult>(text);

  // Some models wrap the response in an array — unwrap it
  if (Array.isArray(result)) {
    result = result[0] as ExtractionResult;
  }

  // Normalize: some models return entityType instead of entity_type
  const raw = result as unknown as Record<string, unknown>;
  if (!raw.entity_type && raw.entityType) {
    result.entity_type = raw.entityType as EntityType;
  }
  if (!raw.entity_name && raw.entityName !== undefined) {
    result.entity_name = raw.entityName as string | null;
  }
  if (!raw.structured_data && raw.structuredData) {
    result.structured_data = raw.structuredData as Record<string, unknown>;
  }
  if (!raw.suggested_connections && raw.suggestedConnections) {
    result.suggested_connections = raw.suggestedConnections as ExtractionResult["suggested_connections"];
  }
  if (!result.summary && typeof raw.summary === "string") {
    result.summary = raw.summary;
  }
  result.summary = result.summary ?? null;

  return result;
}
