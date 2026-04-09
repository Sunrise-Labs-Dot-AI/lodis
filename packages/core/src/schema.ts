import { sqliteTable, text, real, integer } from "drizzle-orm/sqlite-core";

export const memories = sqliteTable("memories", {
  id: text("id").primaryKey(),
  content: text("content").notNull(),
  detail: text("detail"),
  domain: text("domain").notNull().default("general"),
  sourceAgentId: text("source_agent_id").notNull(),
  sourceAgentName: text("source_agent_name").notNull(),
  crossAgentId: text("cross_agent_id"),
  crossAgentName: text("cross_agent_name"),
  sourceType: text("source_type").notNull(),
  sourceDescription: text("source_description"),
  confidence: real("confidence").notNull().default(0.7),
  confirmedCount: integer("confirmed_count").notNull().default(0),
  correctedCount: integer("corrected_count").notNull().default(0),
  mistakeCount: integer("mistake_count").notNull().default(0),
  usedCount: integer("used_count").notNull().default(0),
  learnedAt: text("learned_at"),
  confirmedAt: text("confirmed_at"),
  lastUsedAt: text("last_used_at"),
  deletedAt: text("deleted_at"),
  hasPiiFlag: integer("has_pii_flag").notNull().default(0),
  entityType: text("entity_type"),
  entityName: text("entity_name"),
  structuredData: text("structured_data"),
});

export const memoryConnections = sqliteTable("memory_connections", {
  sourceMemoryId: text("source_memory_id")
    .notNull()
    .references(() => memories.id),
  targetMemoryId: text("target_memory_id")
    .notNull()
    .references(() => memories.id),
  relationship: text("relationship").notNull(),
});

export const memoryEvents = sqliteTable("memory_events", {
  id: text("id").primaryKey(),
  memoryId: text("memory_id")
    .notNull()
    .references(() => memories.id),
  eventType: text("event_type").notNull(),
  agentId: text("agent_id"),
  agentName: text("agent_name"),
  oldValue: text("old_value"),
  newValue: text("new_value"),
  timestamp: text("timestamp").notNull(),
});

export const agentPermissions = sqliteTable("agent_permissions", {
  agentId: text("agent_id").notNull(),
  domain: text("domain").notNull(),
  canRead: integer("can_read").notNull().default(1),
  canWrite: integer("can_write").notNull().default(1),
});
