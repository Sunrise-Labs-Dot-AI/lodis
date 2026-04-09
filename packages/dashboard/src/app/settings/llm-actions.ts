"use server";

import { loadConfig, saveConfig, createLLMProvider } from "@engrams/core";

export async function saveLLMConfig(
  provider: string,
  apiKey: string,
  baseUrl: string,
  extractionModel: string,
  analysisModel: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    // Test the connection first
    const llm = createLLMProvider({
      provider: provider as "anthropic" | "openai" | "ollama",
      apiKey: apiKey || undefined,
      baseUrl: baseUrl || undefined,
    }, "extraction");
    await llm.complete("Say 'ok' and nothing else.", { maxTokens: 10 });

    // Save to config
    const config = loadConfig();
    config.llm = {
      provider: provider as "anthropic" | "openai" | "ollama",
      apiKey: apiKey || undefined,
      baseUrl: baseUrl || undefined,
      models: {
        extraction: extractionModel || undefined,
        analysis: analysisModel || undefined,
      },
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
  extractionModel?: string;
  analysisModel?: string;
}> {
  const config = loadConfig();
  if (config.llm?.provider) {
    return {
      configured: true,
      provider: config.llm.provider,
      model: config.llm.model,
      extractionModel: config.llm.models?.extraction,
      analysisModel: config.llm.models?.analysis,
    };
  }
  // Check env vars
  if (process.env.ANTHROPIC_API_KEY) {
    return { configured: true, provider: "anthropic" };
  }
  if (process.env.OPENAI_API_KEY) {
    return { configured: true, provider: "openai" };
  }
  return { configured: false };
}
