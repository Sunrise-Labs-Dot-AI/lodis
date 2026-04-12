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
  summary: text("summary"),
  permanence: text("permanence"),
  expiresAt: text("expires_at"),
  archivedAt: text("archived_at"),
  userId: text("user_id"),
  updatedAt: text("updated_at"),
});

export const memoryConnections = sqliteTable("memory_connections", {
  sourceMemoryId: text("source_memory_id")
    .notNull()
    .references(() => memories.id),
  targetMemoryId: text("target_memory_id")
    .notNull()
    .references(() => memories.id),
  relationship: text("relationship").notNull(),
  userId: text("user_id"),
  updatedAt: text("updated_at"),
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
  userId: text("user_id"),
  timestamp: text("timestamp").notNull(),
});

export const agentPermissions = sqliteTable("agent_permissions", {
  agentId: text("agent_id").notNull(),
  domain: text("domain").notNull(),
  canRead: integer("can_read").notNull().default(1),
  canWrite: integer("can_write").notNull().default(1),
  userId: text("user_id"),
});

export const userSettings = sqliteTable("user_settings", {
  userId: text("user_id").primaryKey(),
  tier: text("tier").notNull().default("local"), // 'local' | 'cloud'
  // DEPRECATED: byok_* columns retained to avoid migration; no longer used after LLM removal
  byokProvider: text("byok_provider"),
  byokApiKeyEnc: text("byok_api_key_enc"),
  byokBaseUrl: text("byok_base_url"),
  byokExtractionModel: text("byok_extraction_model"),
  byokAnalysisModel: text("byok_analysis_model"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const memorySummaries = sqliteTable("memory_summaries", {
  id: text("id").primaryKey(),
  entityName: text("entity_name").notNull(),
  entityType: text("entity_type").notNull(),
  summary: text("summary").notNull(),
  memoryIds: text("memory_ids").notNull(), // JSON array
  tokenCount: integer("token_count").notNull(),
  generatedAt: text("generated_at").notNull(),
  userId: text("user_id"),
});

export const apiTokens = sqliteTable("api_tokens", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  tokenHash: text("token_hash").notNull().unique(),  // SHA-256(token)
  tokenPrefix: text("token_prefix").notNull(),        // first 8 chars for display: "engrams_ab12..."
  name: text("name").notNull(),                       // "Claude Desktop", "Cursor", etc.
  scopes: text("scopes").notNull().default("read,write"),
  expiresAt: text("expires_at"),                      // NULL = no expiration
  lastUsedAt: text("last_used_at"),
  lastIp: text("last_ip"),
  revokedAt: text("revoked_at"),                      // soft revoke
  createdAt: text("created_at").notNull(),
});

export const cleanupDismissals = sqliteTable("cleanup_dismissals", {
  id: text("id").primaryKey(),
  userId: text("user_id"),
  suggestionKey: text("suggestion_key").notNull(),
  suggestionType: text("suggestion_type").notNull(),
  action: text("action").notNull(), // 'dismissed' | 'resolved'
  resolutionNote: text("resolution_note"),
  createdAt: text("created_at").notNull(),
});
