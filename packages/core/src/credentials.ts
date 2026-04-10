import { resolve } from "path";
import { homedir } from "os";
import { readFileSync, writeFileSync, existsSync, chmodSync } from "fs";
import { randomBytes, randomUUID, createCipheriv, createDecipheriv, scryptSync } from "crypto";

const ENGRAMS_DIR = resolve(homedir(), ".engrams");
const CRED_PATH = resolve(ENGRAMS_DIR, "credentials.json");
const CONFIG_PATH = resolve(ENGRAMS_DIR, "config.json");

export interface Credentials {
  deviceId: string;
  salt: string; // base64 encoded
  apiKey?: string; // Pro tier cloud API key
  tursoUrl?: string;
  tursoAuthToken?: string;
  passphraseHash?: string; // scrypt hash to verify passphrase on entry, NOT the key itself
}

export function loadCredentials(): Credentials | null {
  if (!existsSync(CRED_PATH)) return null;
  try {
    return JSON.parse(readFileSync(CRED_PATH, "utf8"));
  } catch {
    return null;
  }
}

export function saveCredentials(creds: Credentials): void {
  writeFileSync(CRED_PATH, JSON.stringify(creds, null, 2), "utf8");
  try { chmodSync(CRED_PATH, 0o600); } catch { /* non-critical */ }
}

export interface EngramsConfig {
  llm?: {
    provider: "anthropic" | "openai" | "ollama";
    model?: string;
    models?: {
      extraction?: string;
      analysis?: string;
    };
    apiKey?: string;
    baseUrl?: string;
  };
}

// --- Config secret encryption ---
// Uses device-bound key (deviceId + salt from credentials.json) to encrypt
// API keys at rest. Not passphrase-gated — protects against casual plaintext
// exposure but not a determined attacker with access to both files.

const CONFIG_KEY_LENGTH = 32;
const CONFIG_IV_LENGTH = 12;
const CONFIG_TAG_LENGTH = 16;
const ENC_PREFIX = "enc:";

function deriveConfigKey(creds: Credentials): Buffer {
  const salt = Buffer.from(creds.salt, "base64");
  return scryptSync(creds.deviceId, salt, CONFIG_KEY_LENGTH, {
    N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024,
  });
}

function encryptSecret(plaintext: string, key: Buffer): string {
  const iv = randomBytes(CONFIG_IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ENC_PREFIX + Buffer.concat([iv, encrypted, tag]).toString("base64");
}

function decryptSecret(encoded: string, key: Buffer): string {
  if (!encoded.startsWith(ENC_PREFIX)) return encoded; // plaintext fallback
  const data = Buffer.from(encoded.slice(ENC_PREFIX.length), "base64");
  const iv = data.subarray(0, CONFIG_IV_LENGTH);
  const tag = data.subarray(data.length - CONFIG_TAG_LENGTH);
  const ciphertext = data.subarray(CONFIG_IV_LENGTH, data.length - CONFIG_TAG_LENGTH);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(ciphertext) + decipher.final("utf8");
}

export function loadConfig(): EngramsConfig {
  if (!existsSync(CONFIG_PATH)) return {};
  try {
    const config = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as EngramsConfig;

    // Decrypt API key if encrypted
    if (config.llm?.apiKey) {
      const creds = loadCredentials();
      if (creds && config.llm.apiKey.startsWith(ENC_PREFIX)) {
        try {
          const key = deriveConfigKey(creds);
          config.llm.apiKey = decryptSecret(config.llm.apiKey, key);
        } catch {
          // Decryption failed — key may have been rotated. Return as-is.
        }
      }
    }
    return config;
  } catch {
    return {};
  }
}

export function saveConfig(config: EngramsConfig): void {
  // Deep clone to avoid mutating the caller's object
  const toWrite = JSON.parse(JSON.stringify(config)) as EngramsConfig;

  // Encrypt API key before writing
  if (toWrite.llm?.apiKey && !toWrite.llm.apiKey.startsWith(ENC_PREFIX)) {
    const creds = loadCredentials() || initCredentials();
    const key = deriveConfigKey(creds);
    toWrite.llm.apiKey = encryptSecret(toWrite.llm.apiKey, key);
  }

  writeFileSync(CONFIG_PATH, JSON.stringify(toWrite, null, 2), "utf8");
  try { chmodSync(CONFIG_PATH, 0o600); } catch { /* non-critical */ }
}

export function initCredentials(): Credentials {
  const existing = loadCredentials();
  if (existing) return existing;

  const creds: Credentials = {
    deviceId: randomUUID(),
    salt: randomBytes(32).toString("base64"),
  };
  saveCredentials(creds);
  return creds;
}
