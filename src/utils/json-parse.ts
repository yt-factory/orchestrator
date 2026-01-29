import { logger } from './logger';

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
