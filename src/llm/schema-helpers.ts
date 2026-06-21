// Defensive Zod helpers for LLM-generated manifest fields.
//
// LLM output is unpredictable: it invents enum values for unfamiliar domains,
// omits "obvious" required fields, and overruns length caps. A single such field
// would otherwise hard-reject the WHOLE manifest at the Stage 9 validation gate
// (ProjectManifestSchema.parse). These helpers convert invalid input into the
// nearest valid value + a warning, so one odd field never blocks an otherwise
// good manifest. They are purely additive: valid input passes through unchanged.
//
// Three failure modes, three helpers (+ a string variant of overflow):
//   B. invalid/missing enum value   -> coerceEnum            (ep51: entity.type)
//   A. missing required field       -> defaultIfMissing      (ep58: faq.related_entities)
//   D. array / string over the cap  -> truncate*IfOverflow   (LLM exceeds max(N))
//
// Each takes an optional `onCoerce` callback (defaults to logger.warn) so tests
// can assert coercion fired and future eval tooling can count coercions per koan
// as a prompt-quality signal — without grepping logs.

import { z } from 'zod';
import { logger } from '../utils/logger';

export type OnCoerce = (message: string, context: Record<string, unknown>) => void;

const defaultOnCoerce: OnCoerce = (message, context) => logger.warn(message, context);

/**
 * Pattern B — coerce an enum field. Any value outside `validValues` (including
 * undefined, null, or a wrong type) becomes `fallback` with a warning. Base type
 * is `unknown` so a *missing* enum is handled as well as an *invalid* one.
 */
export function coerceEnum<const T extends readonly [string, ...string[]]>(
  validValues: T,
  fallback: T[number],
  fieldName: string,
  onCoerce: OnCoerce = defaultOnCoerce,
) {
  const valid = validValues as readonly string[];
  return z.unknown().transform((val): T[number] => {
    if (typeof val === 'string' && valid.includes(val)) return val as T[number];
    onCoerce(`Invalid ${fieldName} ${JSON.stringify(val)} coerced to "${fallback}"`, {
      field: fieldName,
      received: val,
      coercedTo: fallback,
    });
    return fallback;
  });
}

/**
 * Pattern A — supply `defaultValue` when the field is absent (undefined). A
 * present value is validated by `schema` as usual, so this composes with the
 * overflow/truncate helpers (e.g. defaultIfMissing(truncateStringIfOverflow(...))).
 */
export function defaultIfMissing<T>(
  schema: z.ZodType<T>,
  defaultValue: T,
  fieldName: string,
  onCoerce: OnCoerce = defaultOnCoerce,
) {
  return schema.optional().transform((val): T => {
    if (val === undefined) {
      onCoerce(`Missing ${fieldName}, defaulting`, { field: fieldName, coercedTo: defaultValue });
      return defaultValue;
    }
    return val;
  });
}

/** Pattern D (array) — keep the first `maxLength` elements when the LLM overruns. */
export function truncateIfOverflow<T>(
  schema: z.ZodType<T[]>,
  maxLength: number,
  fieldName: string,
  onCoerce: OnCoerce = defaultOnCoerce,
) {
  return schema.transform((arr): T[] => {
    if (arr.length > maxLength) {
      onCoerce(`${fieldName} had ${arr.length} items, truncated to ${maxLength}`, {
        field: fieldName,
        received: arr.length,
        max: maxLength,
      });
      return arr.slice(0, maxLength);
    }
    return arr;
  });
}

/** Pattern D (string) — truncate to `maxChars` when the LLM overruns the cap. */
export function truncateStringIfOverflow(
  maxChars: number,
  fieldName: string,
  onCoerce: OnCoerce = defaultOnCoerce,
) {
  return z.string().transform((s): string => {
    if (s.length > maxChars) {
      onCoerce(`${fieldName} was ${s.length} chars, truncated to ${maxChars}`, {
        field: fieldName,
        received: s.length,
        max: maxChars,
      });
      return s.slice(0, maxChars);
    }
    return s;
  });
}
