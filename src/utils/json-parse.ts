import { logger } from './logger';

/**
 * Normalizes visual_hint values from LLM responses.
 * Gemini sometimes generates 'b_roll' instead of 'b-roll'.
 */
const VISUAL_HINT_NORMALIZATION: Record<string, string> = {
  'b_roll': 'b-roll',
  'broll': 'b-roll',
  'B-roll': 'b-roll',
  'B_roll': 'b-roll',
  'b-Roll': 'b-roll',
};

/**
 * Normalizes script segments to handle LLM inconsistencies.
 * Specifically handles visual_hint variations.
 */
export function normalizeScriptSegments(segments: unknown[]): unknown[] {
  if (!Array.isArray(segments)) return segments;

  return segments.map((segment) => {
    if (segment && typeof segment === 'object' && 'visual_hint' in segment) {
      const seg = segment as Record<string, unknown>;
      const hint = seg.visual_hint as string;
      if (hint && VISUAL_HINT_NORMALIZATION[hint]) {
        return {
          ...seg,
          visual_hint: VISUAL_HINT_NORMALIZATION[hint],
        };
      }
    }
    return segment;
  });
}

/**
 * Normalizes the entire content_engine object to handle LLM inconsistencies.
 */
export function normalizeContentEngine(contentEngine: unknown): unknown {
  if (!contentEngine || typeof contentEngine !== 'object') return contentEngine;

  const ce = contentEngine as Record<string, unknown>;

  if (ce.script && Array.isArray(ce.script)) {
    return {
      ...ce,
      script: normalizeScriptSegments(ce.script),
    };
  }

  return contentEngine;
}

/**
 * Safely parse JSON from Gemini response with error handling.
 * Returns the parsed object or throws with helpful error context.
 */
export function safeJsonParse<T>(
  text: string,
  context: { projectId: string; operation: string }
): T {
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    // Log the raw response for debugging
    logger.error('JSON parse failed', {
      projectId: context.projectId,
      operation: context.operation,
      error: (error as Error).message,
      rawTextPreview: text.slice(0, 500)
    });

    throw new Error(
      `Failed to parse JSON in ${context.operation}: ${(error as Error).message}. ` +
      `Raw response starts with: "${text.slice(0, 100)}..."`
    );
  }
}

/**
 * Safely extract a property from parsed JSON with default value.
 */
export function safeExtract<T>(
  parsed: unknown,
  key: string,
  defaultValue: T
): T {
  if (parsed && typeof parsed === 'object' && key in parsed) {
    return (parsed as Record<string, unknown>)[key] as T;
  }
  return defaultValue;
}
