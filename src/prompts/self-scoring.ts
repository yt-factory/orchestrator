import type { GeminiClient, GenerateOptions, GenerateResult } from '../agents/gemini-client';
import { safeJsonParse } from '../utils/json-parse';
import { logger } from '../utils/logger';

/**
 * Instruction suffix appended to prompts to request self-assessment from the LLM.
 */
export const SELF_SCORING_SUFFIX = `
After generating the above, rate your confidence in the quality of your output on a scale of 1-10:
- 10: Exceptional, publishable as-is
- 7-9: Good, ready to publish
- 4-6: Acceptable but could be better
- 1-3: Poor, should be regenerated

Include in your JSON output: "_quality": { "confidence": <number>, "reason": "<brief explanation>" }
`;

export interface SelfScoredResult<T> {
  data: T;
  confidence: number;
  reason: string;
}

interface QualityMeta {
  confidence: number;
  reason: string;
}

const DEFAULT_QUALITY: QualityMeta = {
  confidence: 5,
  reason: 'no self-assessment',
};

/**
 * Extract the _quality field from parsed JSON, falling back to defaults.
 */
function extractQuality(parsed: Record<string, unknown>): QualityMeta {
  const raw = parsed._quality;
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_QUALITY };
  }

  const quality = raw as Record<string, unknown>;
  const confidence = typeof quality.confidence === 'number'
    ? quality.confidence
    : DEFAULT_QUALITY.confidence;
  const reason = typeof quality.reason === 'string'
    ? quality.reason
    : DEFAULT_QUALITY.reason;

  return { confidence, reason };
}

/**
 * Generate content with LLM self-scoring. Retries if confidence is below
 * the minimum threshold, returning the best result across all attempts.
 */
export async function generateWithSelfScoring<T>(
  geminiClient: GeminiClient,
  prompt: string,
  options: GenerateOptions,
  minConfidence: number,
  maxRetries: number = 1,
): Promise<SelfScoredResult<T>> {
  let best: SelfScoredResult<T> | null = null;
  let currentPrompt = prompt + SELF_SCORING_SUFFIX;

  const totalAttempts = 1 + maxRetries;

  for (let attempt = 1; attempt <= totalAttempts; attempt++) {
    const result: GenerateResult = await geminiClient.generate(currentPrompt, options);

    const parsed = safeJsonParse<Record<string, unknown>>(result.text, {
      projectId: options.projectId,
      operation: 'self-scoring',
    });

    const quality = extractQuality(parsed);
    const data = stripQualityMeta<T>(parsed as T & { _quality?: unknown });

    logger.info('Self-scoring attempt', {
      projectId: options.projectId,
      attempt,
      confidence: quality.confidence,
      reason: quality.reason,
      modelUsed: result.modelUsed,
    });

    const scored: SelfScoredResult<T> = {
      data,
      confidence: quality.confidence,
      reason: quality.reason,
    };

    // Track the best result across all attempts
    if (!best || scored.confidence > best.confidence) {
      best = scored;
    }

    // Return early if confidence meets the threshold
    if (quality.confidence >= minConfidence) {
      return scored;
    }

    // If retries remain, build a retry prompt with feedback context
    if (attempt < totalAttempts) {
      currentPrompt =
        prompt +
        `\n\nPrevious attempt scored ${quality.confidence}/10 because: '${quality.reason}'. Improve on this.` +
        SELF_SCORING_SUFFIX;
    }
  }

  // Return the best result even if it never met the threshold
  return best!;
}

/**
 * Remove the _quality metadata field from LLM output, returning clean data.
 */
export function stripQualityMeta<T>(data: T & { _quality?: unknown }): T {
  const { _quality, ...rest } = data as Record<string, unknown> & { _quality?: unknown };
  return rest as T;
}
