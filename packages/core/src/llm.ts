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
  model?: string;
  apiKey?: string;
  baseUrl?: string;
}

/**
 * Task-specific model routing.
 * Extraction is high-volume/low-stakes (runs on every write) → cheap model.
 * Analysis is low-volume/high-stakes (user-initiated correct/split) → capable model.
 */
export type LLMTask = "extraction" | "analysis";

/**
 * Default models per provider — used when user only specifies provider + key.
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
        undefined,
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

    // Build system prompt — enforce JSON output when requested
    let system = options?.system ?? "";
    if (options?.json) {
      const jsonDirective = "You MUST respond with ONLY valid JSON. No markdown fences, no preamble, no explanation — just the JSON object.";
      system = system ? `${system}\n\n${jsonDirective}` : jsonDirective;
    }

    // Prefill assistant with "{" to force JSON start when json mode is requested
    const messages: { role: "user" | "assistant"; content: string }[] = [
      { role: "user", content: prompt },
    ];
    if (options?.json) {
      messages.push({ role: "assistant", content: "{" });
    }

    const response = await client.messages.create({
      model: this.model,
      max_tokens: options?.maxTokens ?? 1024,
      ...(system ? { system } : {}),
      messages,
    });
    const text = response.content[0].type === "text" ? response.content[0].text : "";

    // If we prefilled with "{", prepend it to the response
    if (options?.json) {
      return "{" + text;
    }
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
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
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
