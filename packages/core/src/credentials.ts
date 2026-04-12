import { resolve } from "path";
import { homedir } from "os";
import { readFileSync, writeFileSync, existsSync, chmodSync } from "fs";
import { randomBytes, randomUUID } from "crypto";

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
  // LLM config removed — all semantic reasoning delegated to client LLM
}

export function loadConfig(): EngramsConfig {
  if (!existsSync(CONFIG_PATH)) return {};
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as EngramsConfig;
  } catch {
    return {};
  }
}

export function saveConfig(config: EngramsConfig): void {
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf8");
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
