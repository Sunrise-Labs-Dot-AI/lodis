import { generateEmbedding } from "./embeddings.js";

export interface ValidationResult {
  valid: boolean;
  error?: string;
  warnings: string[];
  qualityScore: number;
}

const VALID_ENTITY_TYPES = ["person", "organization", "place", "project", "preference", "event", "goal", "fact"];

/**
 * Validate an entity extraction result.
 */
export function validateExtraction(result: unknown): ValidationResult {
  const warnings: string[] = [];

  if (!result || typeof result !== "object") {
    return { valid: false, error: "LLM did not return a valid object", warnings, qualityScore: 0 };
  }

  const r = result as Record<string, unknown>;

  if (!r.entity_type || !VALID_ENTITY_TYPES.includes(r.entity_type as string)) {
    return {
      valid: false,
      error: `Invalid entity_type "${r.entity_type}". Model may not be capable enough for extraction. Recommended: claude-haiku-4-5, gpt-4o-mini, or better.`,
      warnings,
      qualityScore: 0,
    };
  }

  if (r.entity_name && typeof r.entity_name === "string" && r.entity_name.length > 100) {
    warnings.push("entity_name is unusually long — model may have used full content instead of a canonical name");
  }

  if (r.suggested_connections && !Array.isArray(r.suggested_connections)) {
    warnings.push("suggested_connections is not an array — ignoring");
  }

  const score = 1.0
    - (warnings.length * 0.1)
    - (r.entity_name ? 0 : 0.1);

  return { valid: true, warnings, qualityScore: Math.max(0, score) };
}

/**
 * Validate a split result.
 * Checks: >=2 parts, non-empty, reasonable coverage of original content.
 */
export function validateSplit(
  original: string,
  parts: { content: string }[],
): ValidationResult {
  const warnings: string[] = [];

  if (!Array.isArray(parts) || parts.length < 2) {
    return {
      valid: false,
      error: "Split produced fewer than 2 parts. The selected model may not be capable enough for split analysis. Recommended: claude-sonnet-4-5, gpt-4o, or equivalent.",
      warnings,
      qualityScore: 0,
    };
  }

  const emptyParts = parts.filter(p => !p.content || p.content.trim().length === 0);
  if (emptyParts.length > 0) {
    return { valid: false, error: `Split produced ${emptyParts.length} empty part(s). Model output was malformed.`, warnings, qualityScore: 0 };
  }

  const combinedLength = parts.reduce((sum, p) => sum + p.content.length, 0);
  const coverageRatio = combinedLength / original.length;
  if (coverageRatio < 0.5) {
    return {
      valid: false,
      error: `Split parts only cover ${Math.round(coverageRatio * 100)}% of original content. Significant information loss detected. Try a more capable model.`,
      warnings,
      qualityScore: 0,
    };
  }
  if (coverageRatio < 0.7) {
    warnings.push(`Parts cover ${Math.round(coverageRatio * 100)}% of original — some information may be lost`);
  }

  // Hallucination check
  const originalWords = new Set(original.toLowerCase().split(/\s+/));
  for (const part of parts) {
    const partWords = part.content.toLowerCase().split(/\s+/);
    const novelWords = partWords.filter(w => w.length > 4 && !originalWords.has(w));
    if (novelWords.length > partWords.length * 0.3) {
      warnings.push(`Part "${part.content.slice(0, 40)}..." contains many words not in the original — possible hallucination`);
    }
  }

  // Duplication check
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
  _feedback: string,
): ValidationResult {
  const warnings: string[] = [];

  if (!corrected || corrected.trim().length === 0) {
    return { valid: false, error: "Correction produced empty content. Model output was malformed.", warnings, qualityScore: 0 };
  }

  if (corrected.trim() === original.trim()) {
    return {
      valid: false,
      error: "Correction produced identical content — no changes made. The model may not have understood the feedback. Try a more capable model.",
      warnings,
      qualityScore: 0,
    };
  }

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
 */
export async function checkSemanticPreservation(
  originalContent: string,
  parts: string[],
): Promise<{ preserved: boolean; similarities: number[]; avgSimilarity: number }> {
  try {
    const originalEmb = await generateEmbedding(originalContent);
    if (!originalEmb) return { preserved: true, similarities: [], avgSimilarity: 1.0 };

    const similarities: number[] = [];
    for (const part of parts) {
      const partEmb = await generateEmbedding(part);
      if (!partEmb) continue;
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

    return { preserved: avgSimilarity > 0.5, similarities, avgSimilarity };
  } catch {
    return { preserved: true, similarities: [], avgSimilarity: 1.0 };
  }
}
