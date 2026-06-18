// BaseLLMProvider — shared orchestration for all LLM providers.
//
// This wraps every completion with the same machinery the legacy GeminiClient
// used (priority queue -> token bucket -> circuit breaker -> cost tracking),
// hoisted in commit 1 to llm/base/. Subclasses implement only the provider-
// specific bits: the actual API call, tier->model resolution, and pricing.
//
// Orchestration order mirrors GeminiClient.generate() exactly:
//   1. fast-fail if the circuit breaker is OPEN
//   2. enqueue with priority
//   3. acquire a rate-limit token
//   4. _doComplete() (provider's real API call, with its own retry/fallback)
//   5. record success/failure on the breaker
//   6. always dequeue

import { TokenBucket } from './token-bucket';
import { CircuitBreaker, CircuitOpenError } from './circuit-breaker';
import { CostTracker } from './cost-tracker';
import { PriorityQueue, type Priority } from './priority-queue';
import { logger } from '../../utils/logger';
import type { CostTracking } from '../../core/manifest';
import type {
  CompleteOptions,
  CompletionResult,
  ProviderConfig,
  Tier,
  TokenUsage,
} from '../types';

export abstract class BaseLLMProvider {
  readonly name: string;
  protected readonly rateLimiter: TokenBucket;
  protected readonly circuitBreaker: CircuitBreaker;
  protected readonly costTracker: CostTracker;
  protected readonly priorityQueue: PriorityQueue;

  constructor(config: ProviderConfig) {
    this.name = config.name;

    const rpm = config.rateLimitRpm ??
      parseInt(process.env.LLM_RATE_LIMIT_RPM ?? '60', 10);
    this.rateLimiter = new TokenBucket({
      maxTokens: rpm,
      refillRate: rpm / 60,
    });

    this.circuitBreaker = new CircuitBreaker({
      failureThreshold: config.circuitBreaker?.failureThreshold ?? 5,
      resetTimeoutMs: config.circuitBreaker?.resetTimeoutMs ?? 30_000,
      successThreshold: config.circuitBreaker?.successThreshold ?? 2,
      name: `${config.name}-llm`,
    });

    this.priorityQueue = new PriorityQueue({
      maxConcurrent: config.priorityQueue?.maxConcurrent ?? 5,
      maxQueueSize: config.priorityQueue?.maxQueueSize ?? 100,
    });

    // Use the injected shared tracker if provided, else a fresh per-instance one.
    this.costTracker = config.costTracker ?? new CostTracker();
  }

  /** Initialize provider state (cost tracker disk load, model warm-up, etc.). */
  async warmUp(): Promise<void> {
    await this.costTracker.init();
  }

  // --- Operational accessors (parity with the legacy GeminiClient surface) ---

  /** Cumulative cost/token report from the (possibly shared) cost tracker. */
  getCostReport(): CostTracking {
    return this.costTracker.getReport();
  }

  /** Snapshot of total tokens used so far (for per-project delta calculation). */
  getTokenSnapshot(): number {
    return this.costTracker.getReport().total_tokens_used;
  }

  /** Currently available rate-limit tokens (for status logging). */
  getAvailableTokens(): number {
    return this.rateLimiter.getAvailableTokens();
  }

  /** Graceful shutdown hook. No connection pool with the direct SDKs. */
  async drain(): Promise<void> {
    logger.info('LLM provider drained', { provider: this.name });
  }

  /**
   * Public API: run one completion with full queue/rate-limit/breaker wrapping.
   * Subclasses do NOT override this — they implement _doComplete().
   */
  async complete(
    systemPrompt: string,
    userContent: string,
    opts: CompleteOptions,
  ): Promise<CompletionResult> {
    const priority: Priority = opts.priority ?? 'medium';

    // 1. fast-fail if breaker is open
    if (!this.circuitBreaker.canExecute()) {
      throw new CircuitOpenError(
        `LLM provider '${this.name}' circuit breaker is OPEN.`,
        this.circuitBreaker.getStats(),
      );
    }

    // 2. join the priority queue
    await this.priorityQueue.enqueue(priority);
    const startedAt = Date.now();

    try {
      // 3. rate limit
      await this.rateLimiter.acquire();

      // 4. provider-specific call
      const raw = await this._doComplete(systemPrompt, userContent, opts);

      // 5. success
      this.circuitBreaker.recordSuccess();

      const result: CompletionResult = {
        ...raw,
        latencyMs: Date.now() - startedAt,
        fromLocalCache: false,
      };

      // Global, best-effort token/cost tracking. Provider-accurate USD lives in
      // result.costUsd (via estimateCost); the global CostTracker's pricing
      // table is currently Gemini-centric and will be generalized when the
      // cost-report CLI lands (Phase 6).
      this.costTracker.record(result.model, result.inputTokens + result.outputTokens);

      logger.info('LLM completion', {
        projectId: opts.projectId,
        provider: this.name,
        model: result.model,
        tier: opts.tier,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        cacheHitTokens: result.cacheHitTokens,
        costUsd: result.costUsd,
        latencyMs: result.latencyMs,
      });

      return result;
    } catch (error) {
      // 5. failure (don't double-count an already-open breaker)
      if (!(error instanceof CircuitOpenError)) {
        this.circuitBreaker.recordFailure(error as Error);
      }
      throw error;
    } finally {
      // 6. always release the queue slot
      this.priorityQueue.dequeue();
    }
  }

  /** Provider's real API call. Must populate tokens, cacheHitTokens and costUsd. */
  protected abstract _doComplete(
    systemPrompt: string,
    userContent: string,
    opts: CompleteOptions,
  ): Promise<CompletionResult>;

  /** Map a cost tier to a concrete provider model id. */
  protected abstract resolveModel(tier: Tier): string;

  /** Compute USD cost for a usage record on a given model. */
  protected abstract estimateCost(usage: TokenUsage, model: string): number;
}
