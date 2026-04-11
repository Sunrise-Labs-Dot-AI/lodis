"use server";

import { createClient } from "@libsql/client";
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import { resolve } from "path";
import { homedir } from "os";

const isHosted = () => !!process.env.TURSO_DATABASE_URL;

function getClient() {
  if (process.env.TURSO_DATABASE_URL) {
    return createClient({
      url: process.env.TURSO_DATABASE_URL,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
  }
  return createClient({
    url: "file:" + resolve(homedir(), ".engrams", "engrams.db"),
  });
}

// --- Server-side encryption for BYOK API keys ---

function getServerKey(): Buffer | null {
  const key = process.env.ENGRAMS_ENCRYPTION_KEY;
  if (!key) return null;
  return Buffer.from(key, "base64");
}

function serverEncrypt(plaintext: string): string | null {
  const key = getServerKey();
  if (!key) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, encrypted, tag]).toString("base64");
}

function serverDecrypt(encoded: string): string | null {
  const key = getServerKey();
  if (!key) return null;
  try {
    const data = Buffer.from(encoded, "base64");
    const iv = data.subarray(0, 12);
    const tag = data.subarray(data.length - 16);
    const ciphertext = data.subarray(12, data.length - 16);
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return decipher.update(ciphertext) + decipher.final("utf8");
  } catch {
    return null;
  }
}

// --- Local config helpers (lazy import to avoid fs errors on Vercel) ---

async function loadLocalConfig() {
  const { loadConfig } = await import("@engrams/core/credentials");
  return loadConfig();
}

async function saveLocalConfig(config: Awaited<ReturnType<typeof loadLocalConfig>>) {
  const { saveConfig } = await import("@engrams/core/credentials");
  saveConfig(config);
}

// --- Public actions ---

export async function saveLLMConfig(
  userId: string | null,
  provider: string,
  apiKey: string,
  baseUrl: string,
  extractionModel: string,
  analysisModel: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    // Test the connection first
    const { createLLMProvider } = await import("@engrams/core/llm");
    const llm = createLLMProvider(
      {
        provider: provider as "anthropic" | "openai" | "ollama",
        apiKey: apiKey || undefined,
        baseUrl: baseUrl || undefined,
      },
      "extraction",
    );
    await llm.complete("Say 'ok' and nothing else.", { maxTokens: 10 });

    if (isHosted() && userId) {
      // Store in user_settings in Turso (encrypted)
      const client = getClient();
      const encKey = apiKey ? serverEncrypt(apiKey) : null;
      const timestamp = new Date().toISOString();

      await client.execute({
        sql: `INSERT INTO user_settings (user_id, byok_provider, byok_api_key_enc, byok_base_url, byok_extraction_model, byok_analysis_model, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(user_id) DO UPDATE SET
                byok_provider = excluded.byok_provider,
                byok_api_key_enc = excluded.byok_api_key_enc,
                byok_base_url = excluded.byok_base_url,
                byok_extraction_model = excluded.byok_extraction_model,
                byok_analysis_model = excluded.byok_analysis_model,
                updated_at = excluded.updated_at`,
        args: [
          userId,
          provider,
          encKey,
          baseUrl || null,
          extractionModel || null,
          analysisModel || null,
          timestamp,
          timestamp,
        ],
      });
    } else {
      // Local mode: save to ~/.engrams/config.json
      const config = await loadLocalConfig();
      config.llm = {
        provider: provider as "anthropic" | "openai" | "ollama",
        apiKey: apiKey || undefined,
        baseUrl: baseUrl || undefined,
        models: {
          extraction: extractionModel || undefined,
          analysis: analysisModel || undefined,
        },
      };
      await saveLocalConfig(config);
    }

    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Connection failed",
    };
  }
}

export async function getLLMStatus(userId?: string | null): Promise<{
  configured: boolean;
  provider?: string;
  model?: string;
  extractionModel?: string;
  analysisModel?: string;
  tier?: string;
  managed?: boolean;
}> {
  if (isHosted() && userId) {
    const client = getClient();
    const result = await client.execute({
      sql: `SELECT tier, byok_provider, byok_extraction_model, byok_analysis_model FROM user_settings WHERE user_id = ?`,
      args: [userId],
    });

    if (result.rows.length > 0) {
      const row = result.rows[0];
      const tier = (row.tier as string) || "local";

      // Cloud+ tier: managed LLM, no BYOK needed
      if (tier === "cloud+") {
        return {
          configured: true,
          provider: "anthropic",
          managed: true,
          tier,
        };
      }

      // Pro/Free tier with BYOK configured
      if (row.byok_provider) {
        return {
          configured: true,
          provider: row.byok_provider as string,
          extractionModel: row.byok_extraction_model as string | undefined,
          analysisModel: row.byok_analysis_model as string | undefined,
          tier,
        };
      }

      return { configured: false, tier };
    }

    return { configured: false, tier: "local" };
  }

  // Local mode: read from config.json
  try {
    const config = await loadLocalConfig();
    if (config.llm?.provider) {
      return {
        configured: true,
        provider: config.llm.provider,
        model: config.llm.model,
        extractionModel: config.llm.models?.extraction,
        analysisModel: config.llm.models?.analysis,
      };
    }
  } catch {
    // loadConfig may fail on Vercel (no fs access)
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

/**
 * Resolve an LLM provider for a hosted user. Used by server-side operations
 * (correction, splitting) that need to make LLM calls on behalf of the user.
 */
export async function resolveHostedLLMProvider(
  userId: string,
  task: "extraction" | "analysis" = "extraction",
) {
  const { createLLMProvider } = await import("@engrams/core/llm");
  const client = await getClient();

  const result = await client.execute({
    sql: `SELECT tier, byok_provider, byok_api_key_enc, byok_base_url, byok_extraction_model, byok_analysis_model FROM user_settings WHERE user_id = ?`,
    args: [userId],
  });

  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  const tier = (row.tier as string) || "local";

  // 1. Check BYOK
  if (row.byok_provider && row.byok_api_key_enc) {
    const apiKey = serverDecrypt(row.byok_api_key_enc as string);
    if (apiKey) {
      const model =
        task === "extraction"
          ? (row.byok_extraction_model as string | undefined)
          : (row.byok_analysis_model as string | undefined);
      return createLLMProvider(
        {
          provider: row.byok_provider as "anthropic" | "openai" | "ollama",
          apiKey,
          baseUrl: (row.byok_base_url as string) || undefined,
          model: model || undefined,
        },
        task,
      );
    }
  }

  // 2. Managed tier (cloud+)
  if (tier === "cloud+" && process.env.ENGRAMS_MANAGED_ANTHROPIC_KEY) {
    return createLLMProvider(
      {
        provider: "anthropic",
        apiKey: process.env.ENGRAMS_MANAGED_ANTHROPIC_KEY,
      },
      task,
    );
  }

  return null;
}

export async function updateTier(
  userId: string,
  tier: "local" | "cloud" | "cloud+",
): Promise<void> {
  const client = await getClient();
  await client.execute({
    sql: `INSERT INTO user_settings (user_id, tier, created_at, updated_at)
          VALUES (?, ?, datetime('now'), datetime('now'))
          ON CONFLICT(user_id) DO UPDATE SET tier = ?, updated_at = datetime('now')`,
    args: [userId, tier, tier],
  });
}
