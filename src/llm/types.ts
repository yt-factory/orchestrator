// LLM provider abstraction — shared types (V2 cost-optimization refactor).
//
// `tier` is the central cost lever: every call site must declare whether it
// needs a cheap/fast model or the smart model. See CLAUDE_TASK V2 Phase 2.

import type { Priority } from './base/priority-queue';
import type { CostTracker } from './base/cost-tracker';

/**
 * Capability/cost tier a call site requests.
 * - "fast":  cheap model for structured extraction, ranking, short hooks.
 * - "smart": higher-quality model for creative copy / scripts.
 *
 * Each provider maps these to its own concrete model id via resolveModel().
 */
export type Tier = 'fast' | 'smart';

export interface CompleteOptions {
  /** Required — forces every call site to declare its cost tier. */
  tier: Tier;
  /**
   * Optional project id for structured logging parity with the legacy
   * GeminiClient (the repo convention is "every log line carries project_id").
   */
  projectId?: string;
  jsonMode?: boolean;
  temperature?: number;
  maxTokens?: number;
  /**
   * Priority passed through to the shared PriorityQueue. The real queue uses a
   * string union ('high' | 'medium' | 'low'), not a raw number as the V2 spec
   * pseudocode showed — kept as the union here for type-safety against the
   * existing infrastructure. Defaults to 'medium'.
   */
  priority?: Priority;
  /** Per-call retry budget for the provider's internal call (provider-defined). */
  maxRetries?: number;
  /**
   * Prompt template version for cache invalidation. 0 (default) means "not yet
   * externalized" — the cache uses a hash of the prompt text itself as the
   * version (any edit invalidates). Phase 4 sets this to >=1 per externalized
   * prompt so an explicit version bump drives invalidation.
   */
  templateVersion?: number;
  /** Bypass the content-hash cache for this call (force a fresh API call). */
  noCache?: boolean;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  /** Prefix-cache hit tokens (DeepSeek reports these; 0 for providers without it). */
  cacheHitTokens: number;
}

export interface CompletionResult {
  text: string;
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  /** Prefix-cache hit tokens (DeepSeek prompt_cache_hit_tokens). 0 if unsupported. */
  cacheHitTokens: number;
  costUsd: number;
  /** True when served from our own content-hash cache (Phase 3), not the API. */
  fromLocalCache: boolean;
  latencyMs: number;
}

export interface ProviderConfig {
  /** Stable provider name, e.g. "gemini" | "deepseek". Used in logs and cost rows. */
  name: string;
  /** Requests-per-minute for the token bucket. Defaults to env LLM_RATE_LIMIT_RPM or 60. */
  rateLimitRpm?: number;
  /**
   * Optional shared CostTracker. When injected, multiple clients (e.g. the
   * pipeline provider and the NotebookLM Gemini client) record into one tracker
   * so index.ts can read a single per-project cost snapshot. Defaults to a fresh
   * per-instance tracker.
   */
  costTracker?: CostTracker;
  circuitBreaker?: {
    failureThreshold?: number;
    resetTimeoutMs?: number;
    successThreshold?: number;
  };
  priorityQueue?: {
    maxConcurrent?: number;
    maxQueueSize?: number;
  };
}
