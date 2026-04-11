import type { memories, memoryEvents, memoryConnections, agentPermissions } from "./schema.js";

export type Memory = typeof memories.$inferSelect;
export type NewMemory = typeof memories.$inferInsert;
export type MemoryEvent = typeof memoryEvents.$inferSelect;
export type NewMemoryEvent = typeof memoryEvents.$inferInsert;
export type MemoryConnection = typeof memoryConnections.$inferSelect;
export type NewMemoryConnection = typeof memoryConnections.$inferInsert;
export type AgentPermission = typeof agentPermissions.$inferSelect;

export type SourceType = "stated" | "inferred" | "observed" | "cross-agent";
export type Permanence = "canonical" | "active" | "ephemeral" | "archived";
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
  | "about"
  | "informed_by"
  | "uses"
  | "references";
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
  | "fact"
  | "lesson"
  | "routine"
  | "skill"
  | "resource"
  | "decision";

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

export interface LessonData {
  topic: string;
  context?: string;
  source?: "experience" | "observation" | "advice";
}

export interface RoutineData {
  activity: string;
  frequency?: string;
  status?: "active" | "lapsed" | "aspirational";
}

export interface SkillData {
  domain?: string;
  level?: "beginner" | "intermediate" | "advanced" | "expert";
  context?: string;
}

export interface ResourceData {
  name: string;
  type?: "tool" | "service" | "document" | "url" | "book" | "other";
  url?: string;
  purpose?: string;
}

export interface DocumentIndexData {
  name: string;
  type: "document";
  source_system: string;
  location: string;
  mime_type?: string;
  file_size?: number;
  source_last_modified?: string;
  last_indexed_at: string;
  tags?: string[];
  parent_folder?: string;
  url?: string;
  purpose?: string;
}

export interface DecisionData {
  what: string;
  rationale?: string;
  alternatives?: string[];
  when?: string;
  status?: "active" | "revisiting" | "reversed";
}

export type StructuredData =
  | PersonData
  | OrganizationData
  | PlaceData
  | ProjectData
  | PreferenceData
  | EventData
  | GoalData
  | FactData
  | LessonData
  | RoutineData
  | SkillData
  | ResourceData
  | DocumentIndexData
  | DecisionData;
