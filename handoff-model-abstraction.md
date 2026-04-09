# Handoff: Model Abstraction + BYOK Tier Restructure

**Repo:** `Sunrise-Labs-Dot-AI/engrams` (local at `~/Documents/Claude/Projects/engrams`)
**Branch:** `main`
**Budget:** $12
**Timeout:** 25 min

## Context

Engrams currently hardcodes Anthropic as the only LLM provider. All LLM-powered features (entity extraction, correction, splitting, cleanup) use `@anthropic-ai/sdk` with `claude-sonnet-4-5-20250514`. This locks users into one provider and one model.

This handoff abstracts the LLM layer so users can bring any provider (Anthropic, OpenAI, Ollama/local, or any OpenAI-compatible endpoint) and any model. It also restructures the config to make BYOK the default — all LLM features are free tier, you just supply your own key.

Read `CLAUDE.md` in the repo root for full product context.

**Files that currently hardcode Anthropic:**
- `packages/core/src/entity-extraction.ts` — `import Anthropic from "@anthropic-ai/sdk"`, model: `claude-sonnet-4-5-20250514`
- `packages/dashboard/src/lib/actions.ts` — `import Anthropic from "@anthropic-ai/sdk"`, model: `claude-sonnet-4-6` (for correct/split)
- `packages/mcp-server/src/server.ts` — `import Anthropic from "@anthropic-ai/sdk"` (for proactive split detection on write)

**What does NOT need to change:**
- Embeddings — already local via Transformers.js (`all-MiniLM-L6-v2`), no API dependency
- Search — FTS5 + sqlite-vec, fully local
- Core CRUD — no LLM involvement

## Part 1: LLM Provider Abstraction

### Create `packages/core/src/llm.ts`

```typescript
export interface LLMProvider {
  /**
   * Send a prompt and get a text response.
   * All LLM interactions in Engrams go through this interface.
   */
  complete(prompt: string, options?: LLMOptions): Promise<string>;
}

export interface LLMOptions {
  maxTokens?: number;
  /** Hint that the response should be JSON. Provider implementations may use native JSON mode. */
  json?: boolean;
  /** System prompt, if the provider supports it. */
  system?: string;
}

export interface LLMConfig {
  provider: "anthropic" | "openai" | "ollama";
  model: string;
  apiKey?: string;
  baseUrl?: string; // For OpenAI-compatible endpoints (Groq, Together, Azure, etc.) and Ollama
}

/**
 * Task-specific model routing.
 * Extraction is high-volume/low-stakes (runs on every write) → cheap model.
 * Analysis is low-volume/high-stakes (user-initiated correct/split) → capable model.
 */
export type LLMTask = "extraction" | "analysis";

/**
 * Default configs per provider — used when user only specifies provider + key.
 */
const DEFAULT_MODELS: Record<string, string> = {
  anthropic: "claude-sonnet-4-5-20250514",
  openai: "gpt-4o",
  ollama: "llama3.2",
};

/**
 * Default per-task models by provider.
 * Users can override these in config.json.
 */
const DEFAULT_TASK_MODELS: Record<string, Record<LLMTask, string>> = {
  anthropic: {
    extraction: "claude-haiku-4-5-20251001",
    analysis: "claude-sonnet-4-5-20250514",
  },
  openai: {
    extraction: "gpt-4o-mini",
    analysis: "gpt-4o",
  },
  ollama: {
    extraction: "llama3.2",
    analysis: "llama3.2",
  },
};

/**
 * Create an LLM provider from config.
 * Pass a task to auto-select the right model tier when config.model is not set.
 */
export function createLLMProvider(config: LLMConfig, task?: LLMTask): LLMProvider {
  const model = config.model
    || (task && DEFAULT_TASK_MODELS[config.provider]?.[task])
    || DEFAULT_MODELS[config.provider]
    || "gpt-4o";

  switch (config.provider) {
    case "anthropic":
      return new AnthropicProvider(config.apiKey, model);
    case "openai":
      return new OpenAICompatibleProvider(config.apiKey, model, config.baseUrl);
    case "ollama":
      return new OpenAICompatibleProvider(
        "ollama", // Ollama doesn't need a real key
        model,
        config.baseUrl || "http://localhost:11434/v1",
      );
    default:
      throw new Error(`Unknown LLM provider: ${config.provider}`);
  }
}

class AnthropicProvider implements LLMProvider {
  private client: InstanceType<typeof import("@anthropic-ai/sdk").default> | null = null;
  private apiKey: string | undefined;
  private model: string;

  constructor(apiKey: string | undefined, model: string) {
    this.apiKey = apiKey;
    this.model = model;
  }

  private async getClient() {
    if (!this.client) {
      const { default: Anthropic } = await import("@anthropic-ai/sdk");
      this.client = new Anthropic({ apiKey: this.apiKey });
    }
    return this.client;
  }

  async complete(prompt: string, options?: LLMOptions): Promise<string> {
    const client = await this.getClient();
    const response = await client.messages.create({
      model: this.model,
      max_tokens: options?.maxTokens ?? 1024,
      ...(options?.system ? { system: options.system } : {}),
      messages: [{ role: "user", content: prompt }],
    });
    const text = response.content[0].type === "text" ? response.content[0].text : "";
    return text;
  }
}

class OpenAICompatibleProvider implements LLMProvider {
  private apiKey: string | undefined;
  private model: string;
  private baseUrl: string | undefined;

  constructor(apiKey: string | undefined, model: string, baseUrl?: string) {
    this.apiKey = apiKey;
    this.model = model;
    this.baseUrl = baseUrl;
  }

  async complete(prompt: string, options?: LLMOptions): Promise<string> {
    // Use fetch directly to avoid requiring the openai package as a dependency.
    // This works with OpenAI, Groq, Together, Azure OpenAI, Ollama, and any
    // OpenAI-compatible endpoint.
    const url = `${this.baseUrl || "https://api.openai.com/v1"}/chat/completions`;

    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: options?.maxTokens ?? 1024,
      messages: [
        ...(options?.system ? [{ role: "system", content: options.system }] : []),
        { role: "user", content: prompt },
      ],
    };

    if (options?.json) {
      body.response_format = { type: "json_object" };
    }

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(this.apiKey && this.apiKey !== "ollama"
          ? { Authorization: `Bearer ${this.apiKey}` }
          : {}),
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`LLM request failed (${response.status}): ${error}`);
    }

    const data = await response.json() as {
      choices: { message: { content: string } }[];
    };

    return data.choices[0]?.message?.content ?? "";
  }
}
```

Key design decisions:
- **Lazy imports** — `@anthropic-ai/sdk` is dynamically imported so OpenAI/Ollama users don't need it installed
- **No `openai` dependency** — the OpenAI-compatible provider uses raw `fetch` against the standard `/v1/chat/completions` endpoint. Works with OpenAI, Groq, Together, Azure, Ollama, LMStudio, and anything else that implements the OpenAI API.
- **Default models** — if user just says `provider: "openai"` without a model, we pick `gpt-4o`. Sensible defaults, zero config.

Export from `packages/core/src/index.ts`:
```typescript
export { createLLMProvider, type LLMProvider, type LLMConfig, type LLMOptions, type LLMTask } from "./llm.js";
```

### JSON parsing helper

Create `packages/core/src/llm-utils.ts`:

```typescript
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
```

Export from index.ts. This replaces the duplicate fence-stripping code in entity-extraction.ts and actions.ts.

### Output validation + quality scoring

Create `packages/core/src/llm-validation.ts`:

Every LLM-powered action runs through a validation layer before applying changes. If the model isn't capable enough, the user gets a clear error instead of silently corrupted data.

```typescript
import { generateEmbedding } from "./embeddings.js";
import type Database from "better-sqlite3";

export interface ValidationResult {
  valid: boolean;
  error?: string;
  warnings: string[];
  qualityScore: number; // 0-1, based on structural + semantic checks
}

/**
 * Validate an entity extraction result.
 */
export function validateExtraction(result: unknown): ValidationResult {
  const warnings: string[] = [];

  if (!result || typeof result !== "object") {
    return { valid: false, error: "LLM did not return a valid object", warnings, qualityScore: 0 };
  }

  const r = result as Record<string, unknown>;

  const VALID_TYPES = ["person", "organization", "place", "project", "preference", "event", "goal", "fact"];
  if (!r.entity_type || !VALID_TYPES.includes(r.entity_type as string)) {
    return { valid: false, error: `Invalid entity_type "${r.entity_type}". Model may not be capable enough for extraction. Recommended: claude-haiku-4-5, gpt-4o-mini, or better.`, warnings, qualityScore: 0 };
  }

  if (r.entity_name && typeof r.entity_name === "string" && r.entity_name.length > 100) {
    warnings.push("entity_name is unusually long — model may have used full content instead of a canonical name");
  }

  if (r.suggested_connections && !Array.isArray(r.suggested_connections)) {
    warnings.push("suggested_connections is not an array — ignoring");
  }

  const score = 1.0
    - (warnings.length * 0.1)
    - (r.entity_name ? 0 : 0.1); // slight penalty for missing name

  return { valid: true, warnings, qualityScore: Math.max(0, score) };
}

/**
 * Validate a split result.
 * Checks: ≥2 parts, non-empty, reasonable coverage of original content.
 */
export function validateSplit(
  original: string,
  parts: { content: string }[],
): ValidationResult {
  const warnings: string[] = [];

  if (!Array.isArray(parts) || parts.length < 2) {
    return { valid: false, error: "Split produced fewer than 2 parts. The selected model may not be capable enough for split analysis. Recommended: claude-sonnet-4-5, gpt-4o, or equivalent.", warnings, qualityScore: 0 };
  }

  // Check for empty parts
  const emptyParts = parts.filter(p => !p.content || p.content.trim().length === 0);
  if (emptyParts.length > 0) {
    return { valid: false, error: `Split produced ${emptyParts.length} empty part(s). Model output was malformed.`, warnings, qualityScore: 0 };
  }

  // Coverage check: combined parts should cover at least 60% of original content length
  const combinedLength = parts.reduce((sum, p) => sum + p.content.length, 0);
  const coverageRatio = combinedLength / original.length;
  if (coverageRatio < 0.5) {
    return { valid: false, error: `Split parts only cover ${Math.round(coverageRatio * 100)}% of original content. Significant information loss detected. Try a more capable model.`, warnings, qualityScore: 0 };
  }
  if (coverageRatio < 0.7) {
    warnings.push(`Parts cover ${Math.round(coverageRatio * 100)}% of original — some information may be lost`);
  }

  // Hallucination check: look for words in parts that aren't in original
  const originalWords = new Set(original.toLowerCase().split(/\s+/));
  for (const part of parts) {
    const partWords = part.content.toLowerCase().split(/\s+/);
    const novelWords = partWords.filter(w => w.length > 4 && !originalWords.has(w));
    if (novelWords.length > partWords.length * 0.3) {
      warnings.push(`Part "${part.content.slice(0, 40)}..." contains many words not in the original — possible hallucination`);
    }
  }

  // Duplication check: parts shouldn't be too similar to each other
  for (let i = 0; i < parts.length; i++) {
    for (let j = i + 1; j < parts.length; j++) {
      if (parts[i].content.trim() === parts[j].content.trim()) {
        return { valid: false, error: "Split produced duplicate parts. Model output was malformed.", warnings, qualityScore: 0 };
      }
    }
  }

  const score = Math.min(1.0,
    0.5 + (coverageRatio * 0.3) + (warnings.length === 0 ? 0.2 : 0),
  );

  return { valid: true, warnings, qualityScore: score };
}

/**
 * Validate a correction result.
 * Checks: content actually changed, plausible edit given feedback.
 */
export function validateCorrection(
  original: string,
  corrected: string,
  feedback: string,
): ValidationResult {
  const warnings: string[] = [];

  if (!corrected || corrected.trim().length === 0) {
    return { valid: false, error: "Correction produced empty content. Model output was malformed.", warnings, qualityScore: 0 };
  }

  if (corrected.trim() === original.trim()) {
    return { valid: false, error: "Correction produced identical content — no changes made. The model may not have understood the feedback. Try a more capable model.", warnings, qualityScore: 0 };
  }

  // Check that correction isn't wildly different (complete rewrite vs edit)
  const originalWords = new Set(original.toLowerCase().split(/\s+/));
  const correctedWords = corrected.toLowerCase().split(/\s+/);
  const overlapCount = correctedWords.filter(w => originalWords.has(w)).length;
  const overlapRatio = overlapCount / Math.max(correctedWords.length, 1);

  if (overlapRatio < 0.2) {
    warnings.push("Correction appears to be a complete rewrite rather than an edit — verify this is intended");
  }

  const score = 0.7 + (overlapRatio > 0.3 ? 0.2 : 0) + (warnings.length === 0 ? 0.1 : 0);

  return { valid: true, warnings, qualityScore: Math.min(1.0, score) };
}

/**
 * Semantic preservation check using embeddings.
 * Compares cosine similarity between original content and split parts.
 * Call this as an optional quality gate after validation passes.
 */
export async function checkSemanticPreservation(
  sqlite: Database.Database,
  originalContent: string,
  parts: string[],
): Promise<{ preserved: boolean; similarities: number[]; avgSimilarity: number }> {
  try {
    const originalEmb = await generateEmbedding(originalContent);
    if (!originalEmb) return { preserved: true, similarities: [], avgSimilarity: 1.0 }; // Can't check, assume ok

    const similarities: number[] = [];
    for (const part of parts) {
      const partEmb = await generateEmbedding(part);
      if (!partEmb) continue;
      // Cosine similarity
      let dot = 0, normA = 0, normB = 0;
      for (let i = 0; i < originalEmb.length; i++) {
        dot += originalEmb[i] * partEmb[i];
        normA += originalEmb[i] ** 2;
        normB += partEmb[i] ** 2;
      }
      similarities.push(dot / (Math.sqrt(normA) * Math.sqrt(normB)));
    }

    const avgSimilarity = similarities.length > 0
      ? similarities.reduce((a, b) => a + b, 0) / similarities.length
      : 1.0;

    return {
      preserved: avgSimilarity > 0.5,
      similarities,
      avgSimilarity,
    };
  } catch {
    return { preserved: true, similarities: [], avgSimilarity: 1.0 }; // Non-fatal
  }
}
```

Export from `packages/core/src/index.ts`:
```typescript
export { validateExtraction, validateSplit, validateCorrection, checkSemanticPreservation, type ValidationResult } from "./llm-validation.js";
```

## Part 2: Configuration

### Config file

Add LLM config to `~/.engrams/config.json` (loaded by the credentials/config system).

Update `packages/core/src/credentials.ts` to also handle config:

```typescript
const CONFIG_PATH = resolve(homedir(), ".engrams", "config.json");

export interface EngramsConfig {
  llm?: {
    provider: "anthropic" | "openai" | "ollama";
    model?: string; // Default model for all tasks
    models?: {
      extraction?: string; // High-volume, low-stakes (entity classification on write)
      analysis?: string;   // Low-volume, high-stakes (correct, split, cleanup)
    };
    apiKey?: string; // Provider-specific key. Falls back to env vars.
    baseUrl?: string; // For OpenAI-compatible endpoints or Ollama
  };
}

export function loadConfig(): EngramsConfig {
  if (!existsSync(CONFIG_PATH)) return {};
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    return {};
  }
}

export function saveConfig(config: EngramsConfig): void {
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf8");
  try { chmodSync(CONFIG_PATH, 0o600); } catch {}
}
```

### Provider resolution order

Create `packages/core/src/llm-config.ts`:

```typescript
import { loadConfig, type EngramsConfig } from "./credentials.js";
import { createLLMProvider, type LLMProvider, type LLMConfig } from "./llm.js";

/**
 * Resolve the LLM provider from config + env vars.
 * Pass a task to get the right model tier for that task.
 *
 * Priority:
 * 1. ~/.engrams/config.json llm settings (with per-task model override)
 * 2. Environment variables (ENGRAMS_LLM_PROVIDER, ENGRAMS_LLM_MODEL, ENGRAMS_API_KEY)
 * 3. Legacy env vars (ANTHROPIC_API_KEY, OPENAI_API_KEY) — auto-detect provider
 * 4. null if nothing configured (LLM features disabled)
 */
export function resolveLLMProvider(task?: LLMTask): LLMProvider | null {
  const config = loadConfig();

  // 1. Explicit config file
  if (config.llm?.provider) {
    const apiKey = config.llm.apiKey
      || process.env.ENGRAMS_API_KEY
      || (config.llm.provider === "anthropic" ? process.env.ANTHROPIC_API_KEY : undefined)
      || (config.llm.provider === "openai" ? process.env.OPENAI_API_KEY : undefined);

    // Per-task model override: config.llm.models.extraction or config.llm.models.analysis
    const taskModel = task && config.llm.models?.[task];

    return createLLMProvider({
      provider: config.llm.provider,
      model: taskModel || config.llm.model || "",
      apiKey: apiKey || undefined,
      baseUrl: config.llm.baseUrl,
    }, task);
  }

  // 2. ENGRAMS env vars
  const engramsProvider = process.env.ENGRAMS_LLM_PROVIDER as LLMConfig["provider"] | undefined;
  if (engramsProvider) {
    return createLLMProvider({
      provider: engramsProvider,
      model: process.env.ENGRAMS_LLM_MODEL || "",
      apiKey: process.env.ENGRAMS_API_KEY,
      baseUrl: process.env.ENGRAMS_LLM_BASE_URL,
    }, task);
  }

  // 3. Legacy env var auto-detection
  if (process.env.ANTHROPIC_API_KEY) {
    return createLLMProvider({
      provider: "anthropic",
      model: "",
      apiKey: process.env.ANTHROPIC_API_KEY,
    }, task);
  }
  if (process.env.OPENAI_API_KEY) {
    return createLLMProvider({
      provider: "openai",
      model: "",
      apiKey: process.env.OPENAI_API_KEY,
    }, task);
  }

  // 4. No LLM configured
  return null;
}

/**
 * Get provider or throw a helpful error.
 */
export function requireLLMProvider(task?: LLMTask): LLMProvider {
  const provider = resolveLLMProvider(task);
  if (!provider) {
    throw new Error(
      "No LLM provider configured. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or configure ~/.engrams/config.json. " +
      "LLM features (entity extraction, correction, splitting) require an API key. " +
      "See https://getengrams.com for setup instructions."
    );
  }
  return provider;
}
```

Export both from index.ts.

## Part 3: Update Consumers

### Entity extraction (`packages/core/src/entity-extraction.ts`)

Replace the hardcoded Anthropic import with the provider abstraction:

```typescript
import { type LLMProvider } from "./llm.js";
import { parseLLMJson } from "./llm-utils.js";

export interface ExtractionResult {
  entity_type: string;
  entity_name: string | null;
  structured_data: Record<string, unknown>;
  suggested_connections: {
    target_entity_name: string;
    target_entity_type: string;
    relationship: string;
  }[];
}

export async function extractEntity(
  content: string,
  detail: string | null,
  provider: LLMProvider,
  existingNames?: { entity_name: string; entity_type: string }[],
): Promise<ExtractionResult> {
  const namesContext = existingNames?.length
    ? `\nKnown entities (reuse these exact names when referring to the same entity):\n${existingNames.map(e => `- ${e.entity_type}: ${e.entity_name}`).join("\n")}\n`
    : "";

  const prompt = `Classify this memory and extract structured data.

Memory: ${content}${detail ? `\nDetail: ${detail}` : ""}
${namesContext}
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
```

**Important:** The function now takes `provider: LLMProvider` as a parameter instead of creating its own Anthropic client. The caller is responsible for resolving the provider.

### MCP server (`packages/mcp-server/src/server.ts`)

At server startup, resolve task-specific providers:

```typescript
import { resolveLLMProvider, requireLLMProvider, parseLLMJson, validateExtraction, validateSplit } from "@engrams/core";

// At startup — resolve separate providers for each task tier:
const extractionProvider = resolveLLMProvider("extraction"); // cheap model for high-volume
const analysisProvider = resolveLLMProvider("analysis");     // capable model for user-initiated
```

Pass the right provider to each code path:
- Entity extraction fire-and-forget on `memory_write` → `extractionProvider` (high-volume, cheap)
- `memory_classify` handler → `extractionProvider`
- Proactive split detection on `memory_write` → `extractionProvider`
- User-initiated split/correct (if exposed via MCP) → `analysisProvider`

Replace all `new Anthropic()` calls with the appropriate provider.

For proactive split detection on write, change:
```typescript
// Before:
const anthropic = new Anthropic();
const response = await anthropic.messages.create({...});

// After:
if (!extractionProvider) return; // LLM features disabled, skip
const text = await extractionProvider.complete(prompt, { maxTokens: 500, json: true });
const result = parseLLMJson(text);
```

**Wire in validation after every LLM call in the MCP server:**

For entity extraction (in fire-and-forget and memory_classify):
```typescript
const result = parseLLMJson<ExtractionResult>(text);
const validation = validateExtraction(result);
if (!validation.valid) {
  // Log the error, skip this memory — don't corrupt data
  console.error(`Entity extraction failed validation: ${validation.error}`);
  return;
}
if (validation.warnings.length > 0) {
  console.warn(`Entity extraction warnings: ${validation.warnings.join(", ")}`);
}
// Proceed with validated result...
```

For split proposals:
```typescript
const result = parseLLMJson<{ parts: { content: string }[] }>(text);
const validation = validateSplit(originalContent, result.parts);
if (!validation.valid) {
  return textResult({ error: validation.error });
}
if (validation.warnings.length > 0) {
  // Include warnings in response so the agent/user can see them
  return textResult({ parts: result.parts, warnings: validation.warnings, qualityScore: validation.qualityScore });
}
```

### Dashboard actions (`packages/dashboard/src/lib/actions.ts`)

The dashboard has its own `getApiKey()` function that reads `ANTHROPIC_API_KEY` with a manual `.env.local` fallback. Replace this with the provider abstraction:

```typescript
import { requireLLMProvider, parseLLMJson, validateCorrection, validateSplit, checkSemanticPreservation } from "@engrams/core";

// In correctMemoryAction — use "analysis" task for capable model:
export async function correctMemoryAction(id: string, feedback: string) {
  const provider = requireLLMProvider("analysis"); // capable model for corrections
  // ... build prompt ...
  const text = await provider.complete(prompt, { maxTokens: 500, json: true });
  const result = parseLLMJson(text);

  // Validate before applying
  const validation = validateCorrection(existingContent, result.content, feedback);
  if (!validation.valid) {
    return { error: validation.error };
  }
  // Include warnings in response if any
  // ... apply correction ...
}

// In proposeSplitAction — use "analysis" task for capable model:
export async function proposeSplitAction(id: string, guidance?: string) {
  const provider = requireLLMProvider("analysis"); // capable model for splits
  // ... build prompt ...
  const text = await provider.complete(prompt, { maxTokens: 1000, json: true });
  const result = parseLLMJson(text);

  // Validate before presenting to user
  const validation = validateSplit(originalContent, result.parts);
  if (!validation.valid) {
    return { error: validation.error };
  }

  // Optional: semantic preservation check
  const semantic = await checkSemanticPreservation(sqlite, originalContent, result.parts.map(p => p.content));
  if (!semantic.preserved) {
    return {
      parts: result.parts,
      warning: `Semantic similarity is low (${Math.round(semantic.avgSimilarity * 100)}%). The split may lose meaning. Consider a more capable model.`,
    };
  }

  return { parts: result.parts, qualityScore: validation.qualityScore, warnings: validation.warnings };
}
```

Remove the `getApiKey()` function and the `import Anthropic from "@anthropic-ai/sdk"`. Remove the manual `.env.local` file reading fallback — the provider resolution in `resolveLLMProvider()` handles env vars.

**Keep `@anthropic-ai/sdk` in the MCP server's dependencies** (for users who choose Anthropic) but it's now a lazy import, not a hard requirement at startup.

### Dashboard cleanup page

If the cleanup page uses LLM calls, update those too. Check `packages/dashboard/src/app/cleanup/` for Anthropic imports and replace with the provider abstraction. Cleanup analysis should use `requireLLMProvider("analysis")` since it's user-initiated and quality-sensitive.

## Part 4: Settings Page — LLM Configuration

Add an LLM configuration section to the dashboard settings page.

In `packages/dashboard/src/app/settings/page.tsx`, add a new card:

```typescript
// LLM Provider section
<Card className="p-4">
  <h3 className="text-sm font-semibold mb-3">LLM Provider</h3>
  <p className="text-xs text-[var(--color-text-muted)] mb-4">
    Powers entity extraction, memory correction, and splitting. Bring your own API key — runs on your machine.
  </p>
  <LLMProviderForm />
</Card>
```

Create a client component `packages/dashboard/src/components/llm-provider-form.tsx`:

```typescript
"use client";

// Form with:
// - Provider dropdown: Anthropic, OpenAI, Ollama
// - API key input (masked, not shown for Ollama)
// - Base URL input (shown for OpenAI and Ollama, pre-filled for Ollama)
// - "Model Configuration" subsection with two fields:
//   - Extraction model (high-volume): text input, placeholder shows default for provider
//     Caption: "Used for entity classification on every memory write. A fast, cheap model is fine."
//   - Analysis model (user-initiated): text input, placeholder shows default for provider
//     Caption: "Used for correction, splitting, and cleanup. Use a capable model for best results."
// - "Save & Test" button — saves to config.json and makes a test call with both models
// - Status indicator: "Not configured" / "Connected (extraction: model, analysis: model)" / "Error: ..."
// - Recommended models section (static text):
//   Anthropic: extraction=claude-haiku-4-5, analysis=claude-sonnet-4-5
//   OpenAI: extraction=gpt-4o-mini, analysis=gpt-4o
//   Ollama: extraction=llama3.2, analysis=llama3.2
```

Create server action `packages/dashboard/src/app/settings/llm-actions.ts`:

```typescript
"use server";

import { loadConfig, saveConfig } from "@engrams/core/credentials";
import { createLLMProvider } from "@engrams/core/llm";

export async function saveLLMConfig(
  provider: string,
  model: string,
  apiKey: string,
  baseUrl: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    // Test the connection first
    const llm = createLLMProvider({
      provider: provider as "anthropic" | "openai" | "ollama",
      model,
      apiKey: apiKey || undefined,
      baseUrl: baseUrl || undefined,
    });
    await llm.complete("Say 'ok' and nothing else.", { maxTokens: 10 });

    // Save to config
    const config = loadConfig();
    config.llm = {
      provider: provider as "anthropic" | "openai" | "ollama",
      model: model || undefined,
      apiKey: apiKey || undefined,
      baseUrl: baseUrl || undefined,
    };
    saveConfig(config);

    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Connection failed" };
  }
}

export async function getLLMStatus(): Promise<{
  configured: boolean;
  provider?: string;
  model?: string;
}> {
  const config = loadConfig();
  if (config.llm?.provider) {
    return { configured: true, provider: config.llm.provider, model: config.llm.model };
  }
  // Check env vars
  if (process.env.ANTHROPIC_API_KEY) {
    return { configured: true, provider: "anthropic", model: "claude-sonnet-4-5-20250514" };
  }
  if (process.env.OPENAI_API_KEY) {
    return { configured: true, provider: "openai", model: "gpt-4o" };
  }
  return { configured: false };
}
```

## Part 5: MCP Tool for Config

Add a `memory_configure` MCP tool so users can set up the LLM provider from chat:

```typescript
{
  name: "memory_configure",
  description: "Configure Engrams settings. Currently supports LLM provider setup for entity extraction, correction, and splitting.",
  inputSchema: {
    type: "object",
    properties: {
      llm_provider: {
        type: "string",
        enum: ["anthropic", "openai", "ollama"],
        description: "LLM provider to use"
      },
      llm_extraction_model: {
        type: "string",
        description: "Model for entity extraction (high-volume, cheap). Defaults: anthropic=claude-haiku-4-5, openai=gpt-4o-mini, ollama=llama3.2"
      },
      llm_analysis_model: {
        type: "string",
        description: "Model for correction/splitting (user-initiated, capable). Defaults: anthropic=claude-sonnet-4-5, openai=gpt-4o, ollama=llama3.2"
      },
      llm_api_key: {
        type: "string",
        description: "API key for the provider. Not needed for Ollama."
      },
      llm_base_url: {
        type: "string",
        description: "Custom base URL for OpenAI-compatible endpoints or Ollama."
      }
    },
    required: ["llm_provider"]
  }
}
```

Handler saves to config.json, tests the connection, and reinitializes the server's `llmProvider` instance.

## Part 6: Update README

Add a "Configuration" section to `README.md` covering provider setup:

```markdown
## LLM Provider (optional)

Entity extraction, correction, and splitting use an LLM. Bring your own API key:

### Anthropic (default)
```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

### OpenAI
```bash
export OPENAI_API_KEY=sk-...
export ENGRAMS_LLM_PROVIDER=openai
```

### Ollama (local, free)
```bash
ollama pull llama3.2
export ENGRAMS_LLM_PROVIDER=ollama
```

### Custom OpenAI-compatible endpoint
```bash
export ENGRAMS_LLM_PROVIDER=openai
export ENGRAMS_LLM_MODEL=mixtral-8x7b
export ENGRAMS_LLM_BASE_URL=https://api.together.xyz/v1
export ENGRAMS_API_KEY=...
```

Or configure via `~/.engrams/config.json`:
```json
{
  "llm": {
    "provider": "anthropic",
    "apiKey": "sk-ant-...",
    "models": {
      "extraction": "claude-haiku-4-5-20251001",
      "analysis": "claude-sonnet-4-5-20250514"
    }
  }
}
```

Engrams uses two model tiers:
- **Extraction** (runs on every write): entity classification, proactive split detection. A fast, cheap model is fine.
- **Analysis** (user-initiated): correction, splitting, cleanup. Use a capable model for quality results.

If you don't specify per-task models, sensible defaults are selected per provider.

No LLM? No problem. Core features (search, store, connect, sync) work without one. LLM features are disabled gracefully.
```

## File Changes Summary

| File | Changes |
|------|---------|
| `packages/core/src/llm.ts` | **New**: LLMProvider interface, LLMTask type, per-task model routing, Anthropic + OpenAI-compatible implementations |
| `packages/core/src/llm-utils.ts` | **New**: parseLLMJson helper |
| `packages/core/src/llm-validation.ts` | **New**: validateExtraction, validateSplit, validateCorrection, checkSemanticPreservation |
| `packages/core/src/llm-config.ts` | **New**: resolveLLMProvider (with task param), requireLLMProvider |
| `packages/core/src/credentials.ts` | Add loadConfig, saveConfig, EngramsConfig |
| `packages/core/src/entity-extraction.ts` | Replace Anthropic import with LLMProvider parameter |
| `packages/core/src/index.ts` | Export new modules |
| `packages/mcp-server/src/server.ts` | Replace `new Anthropic()` with `resolveLLMProvider()`, add `memory_configure` tool |
| `packages/dashboard/src/lib/actions.ts` | Replace Anthropic import with requireLLMProvider, remove getApiKey() |
| `packages/dashboard/src/components/llm-provider-form.tsx` | **New**: LLM config form component |
| `packages/dashboard/src/app/settings/page.tsx` | Add LLM Provider card |
| `packages/dashboard/src/app/settings/llm-actions.ts` | **New**: saveLLMConfig, getLLMStatus server actions |
| `README.md` | Add LLM provider configuration section |

## Verification

```bash
pnpm build && pnpm test
```

Then test:
1. **Backward compat**: Set `ANTHROPIC_API_KEY` env var, verify entity extraction and correction still work (auto-detects Anthropic, uses Haiku for extraction, Sonnet for analysis)
2. **OpenAI**: Set `OPENAI_API_KEY` + `ENGRAMS_LLM_PROVIDER=openai`, verify entity extraction works with GPT-4o-mini and correction with GPT-4o
3. **Ollama**: Start Ollama with `ollama serve`, set `ENGRAMS_LLM_PROVIDER=ollama`, verify extraction works locally
4. **No key**: Unset all API keys, verify server starts without errors and LLM features are gracefully disabled (not crashed)
5. **Config file**: Write `~/.engrams/config.json` with per-task models, verify extraction uses the extraction model and correction uses the analysis model
6. **memory_configure tool**: Call via MCP, verify config is saved and provider reinitializes
7. **Dashboard settings**: LLM provider form renders with two model fields, save + test works
8. **Dashboard actions**: Correct and split still work via the provider abstraction
9. **Validation — bad model**: Set analysis model to a very weak model (or intentionally break the response), verify that validation catches it and returns a helpful error instead of corrupting data
10. **Validation — split quality**: Trigger a split, verify that the response includes qualityScore and any warnings

Commit and push when complete.
