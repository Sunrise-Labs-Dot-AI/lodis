"use server";

import { loadCredentials, saveCredentials, initCredentials, deriveKeys, migrateToCloud, migrateToLocal } from "@engrams/core";
import { createClient } from "@libsql/client";
import { scryptSync } from "crypto";
import { resolve } from "path";
import { homedir } from "os";

export async function setupPassphrase(passphrase: string): Promise<{ success: boolean; error?: string }> {
  try {
    const creds = initCredentials();
    const salt = Buffer.from(creds.salt, "base64");

    // Store a hash of the passphrase for verification (NOT the key)
    const hash = scryptSync(passphrase, salt, 32, { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 }).toString("base64");
    creds.passphraseHash = hash;
    saveCredentials(creds);

    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to set passphrase" };
  }
}

export async function saveTursoConfig(url: string, token: string): Promise<{ success: boolean; error?: string }> {
  try {
    // Test connection
    const client = createClient({ url, authToken: token });
    await client.execute("SELECT 1");
    client.close();

    const creds = initCredentials();
    creds.tursoUrl = url;
    creds.tursoAuthToken = token;
    saveCredentials(creds);

    return { success: true };
  } catch (err) {
    return { success: false, error: `Connection failed: ${err instanceof Error ? err.message : "Unknown error"}` };
  }
}

export async function triggerMigration(
  passphrase: string,
  direction: "to_cloud" | "to_local",
): Promise<{ success: boolean; migrated?: number; error?: string }> {
  const creds = loadCredentials();
  if (!creds?.tursoUrl || !creds?.tursoAuthToken) {
    return { success: false, error: "Cloud not configured" };
  }

  const salt = Buffer.from(creds.salt, "base64");
  const keys = deriveKeys(passphrase, salt);

  const localClient = createClient({
    url: "file:" + resolve(homedir(), ".engrams", "engrams.db"),
  });
  const cloudClient = createClient({
    url: creds.tursoUrl,
    authToken: creds.tursoAuthToken,
  });

  try {
    if (direction === "to_cloud") {
      const result = await migrateToCloud(localClient, cloudClient, keys.encryptionKey);
      return { success: true, migrated: result.migrated };
    } else {
      const result = await migrateToLocal(cloudClient, localClient, keys.encryptionKey);
      return { success: true, migrated: result.migrated };
    }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Migration failed" };
  } finally {
    localClient.close();
    cloudClient.close();
  }
}

export async function getSyncStatus(): Promise<{
  hasPassphrase: boolean;
  hasTursoConfig: boolean;
  deviceId: string | null;
}> {
  const creds = loadCredentials();
  return {
    hasPassphrase: !!creds?.passphraseHash,
    hasTursoConfig: !!creds?.tursoUrl && !!creds?.tursoAuthToken,
    deviceId: creds?.deviceId ?? null,
  };
}
