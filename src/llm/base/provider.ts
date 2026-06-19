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
import { computeCacheKey } from '../cache/key';
import { CacheStore, type CacheEntry } from '../cache/store';
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
  protected readonly cacheStore: CacheStore;

  // Cumulative per-process stats for the run summary (cache-hit visibility).
  // input/output/cacheHit/cost accumulate REAL (non-local-cache) calls only,
  // so prefix-cache % reflects actual API traffic; localCacheHits counts hits.
  private readonly runStats = {
    calls: 0,
    localCacheHits: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheHitTokens: 0,
    costUsd: 0,
  };

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

    this.cacheStore = new CacheStore();
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

  /** Cumulative call/token/cache/cost stats since process start (for run summary). */
  getRunStats(): { calls: number; localCacheHits: number; inputTokens: number; outputTokens: number; cacheHitTokens: number; costUsd: number } {
    return { ...this.runStats };
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
    const templateVersion = opts.templateVersion ?? 0;

    // 0. content-hash cache (short-circuits before queue/rate-limit/breaker).
    const cacheEnabled =
      process.env.LLM_CACHE_ENABLED !== 'false' &&
      process.env.LLM_NO_CACHE !== 'true' &&
      !opts.noCache;
    let cacheKey: string | null = null;
    if (cacheEnabled) {
      cacheKey = computeCacheKey({
        provider: this.name,
        tier: opts.tier,
        jsonMode: !!opts.jsonMode,
        templateVersion,
        systemPrompt,
        userContent,
        mockMode: process.env.MOCK_MODE === 'true',
      });
      const cached = await this.cacheStore.load(cacheKey);
      if (cached) {
        const hit: CompletionResult = { ...cached.result, fromLocalCache: true, costUsd: 0 };
        this.runStats.calls += 1;
        this.runStats.localCacheHits += 1;
        logger.info('LLM completion (local cache hit)', {
          projectId: opts.projectId,
          provider: this.name,
          model: hit.model,
          tier: opts.tier,
          fromLocalCache: true,
        });
        return hit;
      }
    }

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

      // Accumulate for the per-run summary (real calls only — see getRunStats()).
      this.runStats.calls += 1;
      this.runStats.inputTokens += result.inputTokens;
      this.runStats.outputTokens += result.outputTokens;
      this.runStats.cacheHitTokens += result.cacheHitTokens;
      this.runStats.costUsd += result.costUsd;

      // Persist to the content-hash cache (best-effort; never fail the call).
      if (cacheEnabled && cacheKey) {
        const entry: CacheEntry = {
          key: cacheKey,
          input_summary: { provider: this.name, tier: opts.tier, template_version: templateVersion },
          result,
          created_at: new Date().toISOString(),
        };
        await this.cacheStore.save(cacheKey, entry, result.costUsd).catch((error) => {
          logger.warn('LLM cache save failed', { error: String(error) });
        });
      }

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
