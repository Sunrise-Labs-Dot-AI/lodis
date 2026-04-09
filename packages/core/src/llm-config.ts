import { loadConfig } from "./credentials.js";
import { createLLMProvider, type LLMProvider, type LLMConfig, type LLMTask } from "./llm.js";

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

    const taskModel = task && config.llm.models?.[task];

    return createLLMProvider({
      provider: config.llm.provider,
      model: taskModel || config.llm.model || undefined,
      apiKey: apiKey || undefined,
      baseUrl: config.llm.baseUrl,
    }, task);
  }

  // 2. ENGRAMS env vars
  const engramsProvider = process.env.ENGRAMS_LLM_PROVIDER as LLMConfig["provider"] | undefined;
  if (engramsProvider) {
    return createLLMProvider({
      provider: engramsProvider,
      model: process.env.ENGRAMS_LLM_MODEL || undefined,
      apiKey: process.env.ENGRAMS_API_KEY,
      baseUrl: process.env.ENGRAMS_LLM_BASE_URL,
    }, task);
  }

  // 3. Legacy env var auto-detection
  if (process.env.ANTHROPIC_API_KEY) {
    return createLLMProvider({
      provider: "anthropic",
      apiKey: process.env.ANTHROPIC_API_KEY,
    }, task);
  }
  if (process.env.OPENAI_API_KEY) {
    return createLLMProvider({
      provider: "openai",
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
      "See https://getengrams.com for setup instructions.",
    );
  }
  return provider;
}
