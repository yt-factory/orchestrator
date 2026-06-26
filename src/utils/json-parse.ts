import { jsonrepair } from 'jsonrepair';
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
 * Layer A — repair-aware parse. Tries a clean `JSON.parse`; on failure, hands the
 * raw text to `jsonrepair` (fixes common LLM JSON defects: trailing commas,
 * misplaced/mismatched braces, smart quotes, unquoted keys, truncated tails).
 *
 * LLM JSON is not guaranteed well-formed even in `json_object` mode, so the raw
 * string → object boundary needs its own defense — this sits *before* the Zod
 * schema-helpers (which only run once parsing has already succeeded).
 *
 * Returns `{ value, recovery }` so callers can observe whether a repair happened.
 * Throws only when both clean parse AND repair fail.
 */
export function parseWithRepair<T>(
  text: string,
  context: { projectId?: string | undefined; operation: string }
): { value: T; recovery: 'clean' | 'repaired' } {
  try {
    return { value: JSON.parse(text) as T, recovery: 'clean' };
  } catch (cleanError) {
    logger.warn('JSON parse failed, attempting repair', {
      projectId: context.projectId,
      operation: context.operation,
      error: (cleanError as Error).message,
      rawTextPreview: text.slice(0, 200),
    });

    try {
      const value = JSON.parse(jsonrepair(text)) as T;
      logger.warn('JSON repaired successfully', {
        projectId: context.projectId,
        operation: context.operation,
      });
      return { value, recovery: 'repaired' };
    } catch (repairError) {
      logger.error('JSON parse failed (repair also failed)', {
        projectId: context.projectId,
        operation: context.operation,
        cleanError: (cleanError as Error).message,
        repairError: (repairError as Error).message,
        rawTextPreview: text.slice(0, 500),
      });

      throw new Error(
        `Failed to parse JSON in ${context.operation}: ${(repairError as Error).message}. ` +
        `Raw response starts with: "${text.slice(0, 100)}..."`
      );
    }
  }
}

/**
 * Safely parse JSON from an LLM response.
 *
 * Backwards-compatible signature, now with Layer A (jsonrepair) folded in: a
 * malformed-but-repairable payload is silently fixed instead of throwing. Throws
 * only when the text is beyond repair. For graceful skip-and-continue semantics
 * (repair → retry → fallback), use {@link robustJsonParse} instead.
 */
export function safeJsonParse<T>(
  text: string,
  context: { projectId: string; operation: string }
): T {
  return parseWithRepair<T>(text, context).value;
}

export type Recovery = 'clean' | 'repaired' | 'retried' | 'fallback';

export interface RobustParseOptions<T> {
  /** Logging label, e.g. "generateFAQ:zh_CN_XHS". */
  operation: string;
  projectId?: string;
  /**
   * Schema-valid empty value returned when all parse strategies fail. Must keep
   * downstream Zod validation happy (e.g. `{ faq: [] }`, not `null`, for a FAQ site).
   */
  fallback: T;
  /**
   * Optional callback to re-invoke the LLM once when repair fails. Should request
   * a fresh, cache-bypassing completion with a corrective hint. Its returned text
   * is itself run through repair before falling back.
   */
  retry?: () => Promise<string>;
}

/**
 * Layer A + B + C — the full skip-and-continue parser for LLM output.
 *
 *   A. clean parse → jsonrepair        (silent fix for most LLM JSON defects)
 *   B. retry()     → re-invoke LLM     (corrective prompt, repair the retry too)
 *   C. fallback    → schema-valid empty (warn + continue; never crash the stage)
 *
 * A local field failure degrades that one field, not the whole manifest. Critical
 * fields should still fail-fast — the caller decides by inspecting `recovery`
 * (e.g. throw when `recovery === 'fallback'` for title/description).
 */
export async function robustJsonParse<T>(
  text: string,
  opts: RobustParseOptions<T>
): Promise<{ value: T; recovery: Recovery }> {
  // Layers A (clean + repair)
  try {
    return parseWithRepair<T>(text, opts);
  } catch {
    // fall through to retry / fallback
  }

  // Layer B — retry once via the LLM, repairing the retry output too.
  if (opts.retry) {
    try {
      const retried = await opts.retry();
      const { value } = parseWithRepair<T>(retried, {
        projectId: opts.projectId,
        operation: `${opts.operation}:retry`,
      });
      logger.warn('JSON parse succeeded on retry', {
        projectId: opts.projectId,
        operation: opts.operation,
      });
      return { value, recovery: 'retried' };
    } catch (retryError) {
      logger.warn('JSON retry also failed', {
        projectId: opts.projectId,
        operation: opts.operation,
        error: (retryError as Error).message,
      });
    }
  }

  // Layer C — graceful fallback.
  logger.error('All JSON parse strategies failed, using fallback', {
    projectId: opts.projectId,
    operation: opts.operation,
    rawTextPreview: text.slice(0, 200),
  });
  return { value: opts.fallback, recovery: 'fallback' };
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
