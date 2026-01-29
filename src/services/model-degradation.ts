import { z } from 'zod';
import type { ErrorFingerprint, ProjectManifest } from '../core/manifest';
import { logger } from '../utils/logger';

// ============================================
// Model Configuration
// ============================================

interface ModelConfig {
  name: string;
  priority: number;
  strictness: 'normal' | 'strict';
  maxTokens: number;
}

// Model hierarchy for fallback chain
const MODEL_HIERARCHY: ModelConfig[] = [
  { name: 'gemini-3-pro-preview', priority: 1, strictness: 'normal', maxTokens: 8192 },
  { name: 'gemini-3-flash-preview', priority: 2, strictness: 'normal', maxTokens: 4096 },
  { name: 'gemini-2.5-flash', priority: 3, strictness: 'normal', maxTokens: 4096 },
  { name: 'gemini-1.5-flash', priority: 4, strictness: 'strict', maxTokens: 2048 }
];

// Errors that can potentially be fixed by degrading to a stricter model
const DEGRADABLE_ERROR_CODES = [
  'invalid_enum_value',
  'too_big',
  'invalid_type',
  'unrecognized_keys',
  'invalid_string',
  'invalid_literal'
];

// ============================================
// Model Degradation Manager
// ============================================

export class ModelDegradationManager {
  /**
   * Parse an error and generate a fingerprint for classification
   */
  parseErrorFingerprint(error: Error | z.ZodError): ErrorFingerprint {
    // Handle Zod validation errors
    if (error instanceof z.ZodError) {
      const firstIssue = error.issues[0];
      if (!firstIssue) {
        return {
          type: 'zod_validation',
          code: 'unknown_zod_error',
          message: error.message
        };
      }

      return {
        type: 'zod_validation',
        code: firstIssue.code,
        path: firstIssue.path.join('.'),
        message: firstIssue.message
      };
    }

    const message = error.message || String(error);

    // Gemini API errors
    if (message.includes('GoogleGenerativeAI') || message.includes('gemini')) {
      return {
        type: 'gemini_api',
        code: this.extractGeminiErrorCode(message),
        message
      };
    }

    // Network errors
    if (
      message.includes('ECONNREFUSED') ||
      message.includes('ETIMEDOUT') ||
      message.includes('network') ||
      message.includes('fetch')
    ) {
      return {
        type: 'network',
        code: 'network_error',
        message
      };
    }

    // File system errors
    if (
      message.includes('ENOENT') ||
      message.includes('EACCES') ||
      message.includes('EPERM')
    ) {
      return {
        type: 'file_system',
        code: this.extractFsErrorCode(message),
        message
      };
    }

    // Unknown error
    return {
      type: 'unknown',
      code: 'unknown',
      message
    };
  }

  /**
   * Determine if the error can be resolved by degrading to a different model
   */
  shouldDegrade(fingerprint: ErrorFingerprint, manifest: ProjectManifest): boolean {
    const meta = manifest.meta;

    // Already used all available models
    if ((meta.used_models?.length ?? 0) >= MODEL_HIERARCHY.length) {
      logger.info('All models exhausted, cannot degrade further', {
        projectId: manifest.project_id,
        usedModels: meta.used_models
      });
      return false;
    }

    // Zod validation errors are often fixable with stricter prompts
    if (fingerprint.type === 'zod_validation') {
      const isDegradable = DEGRADABLE_ERROR_CODES.includes(fingerprint.code);

      if (isDegradable) {
        logger.info('Zod error is degradable', {
          projectId: manifest.project_id,
          errorCode: fingerprint.code,
          errorPath: fingerprint.path
        });
      }

      return isDegradable;
    }

    // Gemini API errors that indicate model issues (not quota/auth)
    if (fingerprint.type === 'gemini_api') {
      // Don't degrade for rate limits or auth errors
      const nonDegradableCodes = ['429', '401', '403', 'quota', 'unauthorized'];
      const isNonDegradable = nonDegradableCodes.some(code =>
        fingerprint.code.toLowerCase().includes(code)
      );

      return !isNonDegradable;
    }

    return false;
  }

  /**
   * Get the next model in the degradation chain
   */
  getNextModel(manifest: ProjectManifest): ModelConfig | null {
    const usedModels = new Set(manifest.meta.used_models ?? []);
    const currentModel = manifest.meta.current_model ?? manifest.meta.model_used;

    // Add current model to used set if not already there
    if (currentModel) {
      usedModels.add(currentModel);
    }

    // Find first unused model in hierarchy
    for (const model of MODEL_HIERARCHY) {
      if (!usedModels.has(model.name)) {
        return model;
      }
    }

    return null;
  }

  /**
   * Get the default/initial model
   */
  getDefaultModel(): ModelConfig {
    return MODEL_HIERARCHY[0]!;
  }

  /**
   * Get all available models
   */
  getAllModels(): ModelConfig[] {
    return [...MODEL_HIERARCHY];
  }

  /**
   * Generate a degraded prompt with stricter constraints for fallback models
   */
  getDegradedPrompt(originalPrompt: string, model: ModelConfig): string {
    if (model.strictness !== 'strict') {
      return originalPrompt;
    }

    // Strict mode: Add explicit schema constraints
    const schemaConstraints = `
CRITICAL CONSTRAINTS (MUST follow exactly):

1. JSON STRUCTURE:
   - Return ONLY valid JSON, no explanations or markdown
   - All strings must be properly escaped
   - No trailing commas
   - No comments in JSON

2. ENUM VALUES:
   - hook_type MUST be exactly one of: "counter_intuitive", "number_shock", "controversy", "quick_tip", "fomo", "curiosity", "awe", "anger", "validation", "surprise", "humor", "empathy", "urgency"
   - emotional_trigger MUST be exactly one of: "anger", "awe", "curiosity", "fomo", "validation"
   - visual_hint MUST be exactly one of: "code_block", "diagram", "text_animation", "b-roll", "screen_recording", "talking_head_placeholder"

3. STRING LENGTH LIMITS:
   - description fields: MAX 500 characters
   - text fields in hooks: MAX 50 characters
   - answers in FAQ: MAX 200 characters

4. ARRAY LIMITS:
   - hooks array: 1-5 items
   - tags: MAX 30 items
   - faq_structured_data: MAX 5 items

5. DO NOT add any fields not specified in the schema
6. DO NOT use null - use optional fields or empty strings/arrays

`;

    return schemaConstraints + '\n---\n\n' + originalPrompt;
  }

  /**
   * Extract Gemini error code from error message
   */
  private extractGeminiErrorCode(message: string): string {
    // Try to extract HTTP status code
    const statusMatch = message.match(/\[(\d{3})\s+(\w+)\]/);
    if (statusMatch) {
      return `${statusMatch[1]}_${statusMatch[2]}`;
    }

    // Try to extract error type
    const typeMatch = message.match(/GoogleGenerativeAI(?:Error)?:\s*(\w+)/i);
    if (typeMatch) {
      return typeMatch[1]!.toLowerCase();
    }

    return 'gemini_unknown';
  }

  /**
   * Extract file system error code
   */
  private extractFsErrorCode(message: string): string {
    const codeMatch = message.match(/(ENOENT|EACCES|EPERM|EEXIST|ENOTDIR)/);
    return codeMatch ? codeMatch[1]!.toLowerCase() : 'fs_unknown';
  }
}

// Export singleton instance
export const modelDegradation = new ModelDegradationManager();

// Export types
export type { ModelConfig };
