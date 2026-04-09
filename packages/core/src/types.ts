import type { memories, memoryEvents, memoryConnections, agentPermissions } from "./schema.js";

export type Memory = typeof memories.$inferSelect;
export type NewMemory = typeof memories.$inferInsert;
export type MemoryEvent = typeof memoryEvents.$inferSelect;
export type NewMemoryEvent = typeof memoryEvents.$inferInsert;
export type MemoryConnection = typeof memoryConnections.$inferSelect;
export type NewMemoryConnection = typeof memoryConnections.$inferInsert;
export type AgentPermission = typeof agentPermissions.$inferSelect;

export type SourceType = "stated" | "inferred" | "observed" | "cross-agent";
export type Relationship =
  | "influences"
  | "supports"
  | "contradicts"
  | "related"
  | "learned-together"
  | "works_at"
  | "involves"
  | "located_at"
  | "part_of"
  | "about";
export type EventType =
  | "created"
  | "confirmed"
  | "corrected"
  | "removed"
  | "confidence_changed"
  | "used";

export type EntityType =
  | "person"
  | "organization"
  | "place"
  | "project"
  | "preference"
  | "event"
  | "goal"
  | "fact";

export interface PersonData {
  name: string;
  role?: string;
  organization?: string;
  relationship_to_user?: string;
}

export interface OrganizationData {
  name: string;
  type?: string;
  user_relationship?: string;
}

export interface PlaceData {
  name: string;
  context?: string;
}

export interface ProjectData {
  name: string;
  status?: string;
  user_role?: string;
}

export interface PreferenceData {
  category?: string;
  strength?: "strong" | "mild" | "contextual";
}

export interface EventData {
  what: string;
  when?: string;
  who?: string[];
}

export interface GoalData {
  what: string;
  timeline?: string;
  status?: "active" | "achieved" | "abandoned";
}

export interface FactData {
  category?: string;
}

export type StructuredData =
  | PersonData
  | OrganizationData
  | PlaceData
  | ProjectData
  | PreferenceData
  | EventData
  | GoalData
  | FactData;
