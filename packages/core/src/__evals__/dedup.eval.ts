import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { hybridSearch } from "../search.js";
import { generateEmbedding } from "../embeddings.js";
import { openRealDb } from "./helpers.js";
import {
  DEDUP_TRUE_POSITIVE_CASES,
  DEDUP_TRUE_NEGATIVE_CASES,
  DEDUP_EDGE_CASES,
} from "./ground-truth.js";
import type { Client } from "@libsql/client";

/**
 * Dedup detection in the write path uses cosine similarity >= 0.7.
 * We replicate that logic here: embed the new content, run hybrid search,
 * and check if the expected existing memory appears with a high enough score.
 */

const WRITE_SIMILARITY_THRESHOLD = 0.7;

let client: Client;
let cleanup: () => void;
let available = false;

beforeAll(async () => {
  const result = await openRealDb();
  if (!result) return;
  client = result.client;
  cleanup = result.cleanup;
  available = true;
});

afterAll(() => {
  if (cleanup) cleanup();
});

async function getEmbeddingSimilarity(memoryId: string, queryEmbedding: Float32Array): Promise<number | null> {
  const result = await client.execute({
    sql: `SELECT vector_distance_cos(embedding, vector(?)) as distance FROM memories WHERE id = ? AND embedding IS NOT NULL`,
    args: [JSON.stringify(Array.from(queryEmbedding)), memoryId],
  });
  if (result.rows.length === 0 || result.rows[0].distance == null) return null;
  return 1 - (result.rows[0].distance as number);
}

describe("dedup evals", () => {
  describe("true positives — should detect as duplicate", () => {
    for (const testCase of DEDUP_TRUE_POSITIVE_CASES) {
      it(`${testCase.name} (${testCase.id})`, async () => {
        if (!available) return;

        const newEmbedding = await generateEmbedding(testCase.newContent);
        const similarity = await getEmbeddingSimilarity(testCase.existingId, newEmbedding);

        if (similarity == null) {
          console.warn(`[dedup] No embedding for ${testCase.existingId}, skipping`);
          return;
        }

        console.log(
          `[dedup] ${testCase.name}: similarity=${similarity.toFixed(4)} threshold=${WRITE_SIMILARITY_THRESHOLD}`,
        );

        expect(
          similarity,
          `Expected similarity >= ${WRITE_SIMILARITY_THRESHOLD} for duplicate detection`,
        ).toBeGreaterThanOrEqual(WRITE_SIMILARITY_THRESHOLD);
      });
    }
  });

  describe("true negatives — should NOT flag as duplicate", () => {
    for (const testCase of DEDUP_TRUE_NEGATIVE_CASES) {
      it(`${testCase.name} (${testCase.id})`, async () => {
        if (!available) return;

        const newEmbedding = await generateEmbedding(testCase.newContent);
        const similarity = await getEmbeddingSimilarity(testCase.existingId, newEmbedding);

        if (similarity == null) {
          console.warn(`[dedup] No embedding for ${testCase.existingId}, skipping`);
          return;
        }

        console.log(
          `[dedup] ${testCase.name}: similarity=${similarity.toFixed(4)} threshold=${WRITE_SIMILARITY_THRESHOLD}`,
        );

        expect(
          similarity,
          `Expected similarity < ${WRITE_SIMILARITY_THRESHOLD} — these are distinct memories`,
        ).toBeLessThan(WRITE_SIMILARITY_THRESHOLD);
      });
    }
  });

  describe("edge cases", () => {
    for (const testCase of DEDUP_EDGE_CASES) {
      it(`${testCase.name} (${testCase.id})`, async () => {
        if (!available) return;

        const newEmbedding = await generateEmbedding(testCase.newContent);
        const similarity = await getEmbeddingSimilarity(testCase.existingId, newEmbedding);

        if (similarity == null) {
          console.warn(`[dedup] No embedding for ${testCase.existingId}, skipping`);
          return;
        }

        console.log(
          `[dedup] ${testCase.name}: similarity=${similarity.toFixed(4)} shouldMatch=${testCase.shouldMatch}`,
        );

        if (testCase.shouldMatch) {
          expect(similarity).toBeGreaterThanOrEqual(WRITE_SIMILARITY_THRESHOLD);
        } else {
          expect(similarity).toBeLessThan(WRITE_SIMILARITY_THRESHOLD);
        }
      });
    }
  });

  describe("dedup via search path", () => {
    it("hybrid search surfaces duplicates in top results", async () => {
      if (!available) return;

      // Use a known duplicate query: rephrasing of Sunrise Labs memory
      const { results } = await hybridSearch(client, "James runs Sunrise Labs as a software studio side project", {
        limit: 5,
        expand: false,
      });

      const topIds = results.map((r) => r.id);
      const hasSunriseMemory = topIds.includes("abb48cda5d12fb1282eb932cf1882fcb");

      console.log(`[dedup] Search-based dedup: found Sunrise Labs memory in top 5: ${hasSunriseMemory}`);
      expect(hasSunriseMemory, "Existing Sunrise Labs memory should surface in dedup search").toBe(true);
    });
  });
});
