import type { EntityType } from "./types.js";
import type { LLMProvider } from "./llm.js";
import { parseLLMJson } from "./llm-utils.js";

export interface ExtractionResult {
  entity_type: EntityType;
  entity_name: string | null;
  structured_data: Record<string, unknown>;
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

  const prompt = `Classify this memory and extract structured data.

Memory: ${content}${detail ? `\nDetail: ${detail}` : ""}${existingNamesHint}

Respond with JSON only:
{
  "entity_type": "person|organization|place|project|preference|event|goal|fact",
  "entity_name": "canonical name or null if not applicable",
  "structured_data": { type-specific fields },
  "suggested_connections": [
    { "target_entity_name": "...", "target_entity_type": "...", "relationship": "works_at|involves|located_at|part_of|about|related" }
  ]
}

Entity type definitions:
- person: about a specific individual
- organization: about a company, team, or group
- place: about a location
- project: about a work project or initiative
- preference: about what the user likes/dislikes/prefers
- event: about something that happened or will happen
- goal: about something the user wants to achieve
- fact: general knowledge that doesn't fit other types

For entity_name, use the canonical form (e.g. "Sarah Chen" not "my manager Sarah"). If an existing entity name matches, use that exact spelling.

For structured_data, include relevant fields:
- person: name, role, organization, relationship_to_user
- organization: name, type, user_relationship
- place: name, context
- project: name, status, user_role
- preference: category, strength (strong/mild/contextual)
- event: what, when, who
- goal: what, timeline, status (active/achieved/abandoned)
- fact: category`;

  const text = await provider.complete(prompt, { maxTokens: 500, json: true });
  return parseLLMJson<ExtractionResult>(text);
}
