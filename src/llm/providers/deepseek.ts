// DeepSeekProvider — primary cost-optimized provider via the OpenAI-compatible
// DeepSeek endpoint. The system message is held stable across calls so DeepSeek's
// prefix cache fires (cache-hit tokens billed at a 98% discount); Phase 4 makes
// the system prompts long+shared to maximize this.

import OpenAI from 'openai';
import { BaseLLMProvider } from '../base/provider';
import type { CostTracker } from '../base/cost-tracker';
import type { CompleteOptions, CompletionResult, Tier, TokenUsage } from '../types';
import { DEEPSEEK_MODELS } from './deepseek-models';
import { maxTokensForTask } from '../task-config';
import { logger } from '../../utils/logger';

/** DeepSeek extends OpenAI's usage object with prefix-cache + reasoning counters. */
interface DeepSeekUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_cache_hit_tokens?: number;
  prompt_cache_miss_tokens?: number;
  completion_tokens_details?: { reasoning_tokens?: number };
}

/** Strip ```json fences in case JSON mode is off and the model wraps output. */
function cleanJsonResponse(rawText: string): string {
  return rawText
    .replace(/^```(?:json)?\s*\n?/, '')
    .replace(/\n?```\s*$/, '')
    .trim();
}

export class DeepSeekProvider extends BaseLLMProvider {
  private readonly client: OpenAI;

  constructor(config: { costTracker?: CostTracker } = {}) {
    super({
      name: 'deepseek',
      rateLimitRpm: parseInt(
        process.env.DEEPSEEK_RATE_LIMIT_RPM ?? process.env.LLM_RATE_LIMIT_RPM ?? '60',
        10,
      ),
      circuitBreaker: {
        failureThreshold: parseInt(process.env.LLM_CIRCUIT_BREAKER_THRESHOLD ?? '5', 10),
        resetTimeoutMs: parseInt(process.env.LLM_CIRCUIT_BREAKER_RESET_MS ?? '30000', 10),
        successThreshold: 2,
      },
      ...(config.costTracker ? { costTracker: config.costTracker } : {}),
    });

    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      throw new Error(
        'DEEPSEEK_API_KEY required when LLM_PROVIDER=deepseek. ' +
        'Add it to .env or switch LLM_PROVIDER=gemini.',
      );
    }

    this.client = new OpenAI({
      apiKey,
      baseURL: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com',
    });
  }

  protected resolveModel(tier: Tier): string {
    return DEEPSEEK_MODELS[tier].id;
  }

  protected estimateCost(usage: TokenUsage, model: string): number {
    const cfg = model === DEEPSEEK_MODELS.smart.id ? DEEPSEEK_MODELS.smart : DEEPSEEK_MODELS.fast;
    const cachedInput = Math.min(usage.cacheHitTokens, usage.inputTokens);
    const freshInput = Math.max(0, usage.inputTokens - cachedInput);
    return (
      (freshInput / 1_000_000) * cfg.inputPerM +
      (cachedInput / 1_000_000) * cfg.cachedInputPerM +
      (usage.outputTokens / 1_000_000) * cfg.outputPerM
    );
  }

  protected async _doComplete(
    systemPrompt: string,
    userContent: string,
    opts: CompleteOptions,
  ): Promise<CompletionResult> {
    const model = this.resolveModel(opts.tier);
    const timeoutMs = parseInt(
      process.env.DEEPSEEK_API_TIMEOUT_MS ?? process.env.GEMINI_API_TIMEOUT_MS ?? '120000',
      10,
    );

    // V4 cost fix: deepseek-v4-flash runs thinking mode by default (Case A: ~71%
    // of output tokens were reasoning). Disable it for the `fast` tier — structured
    // extraction / short hooks don't need chain-of-thought. Leave `smart` on its
    // default (creative copy can benefit from reasoning). DeepSeek param:
    // `{ thinking: { type: 'disabled' } }` (api-docs.deepseek.com, verified 2026-06-20).
    const thinkingOff: Record<string, unknown> =
      opts.tier === 'fast' ? { thinking: { type: 'disabled' } } : {};

    // Output ceiling: explicit opts.maxTokens wins, else the per-task cap (belt &
    // suspenders so no task runs away on output regardless of provider behavior).
    const maxTokens = opts.maxTokens ?? maxTokensForTask(opts.label);

    // OpenAI SDK handles timeout + exponential-backoff retries natively. `thinking`
    // is a DeepSeek extension passed through the body (cast satisfies the OpenAI types).
    const res = await this.client.chat.completions.create(
      {
        model,
        messages: [
          { role: 'system', content: systemPrompt }, // stable -> prefix cache
          { role: 'user', content: userContent }, // variable
        ],
        temperature: opts.temperature ?? 0.7,
        ...(maxTokens !== undefined ? { max_tokens: maxTokens } : {}),
        ...(opts.jsonMode ? { response_format: { type: 'json_object' as const } } : {}),
        ...thinkingOff,
      } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
      { timeout: timeoutMs, maxRetries: opts.maxRetries ?? 3 },
    );

    const text = res.choices[0]?.message?.content ?? '';
    if (!text) {
      throw new Error('Empty response from DeepSeek');
    }

    // Defensive: every DeepSeek-specific field is optional with a 0 fallback so a
    // changed/absent usage shape degrades to "no cache hits" instead of crashing.
    const usage = res.usage as DeepSeekUsage | undefined;
    const inputTokens = usage?.prompt_tokens ?? Math.ceil((systemPrompt.length + userContent.length) / 4);
    const outputTokens = usage?.completion_tokens ?? Math.ceil(text.length / 4);
    const cacheHitTokens = usage?.prompt_cache_hit_tokens ?? 0;
    const reasoningTokens = usage?.completion_tokens_details?.reasoning_tokens ?? 0;
    if (usage && usage.prompt_cache_hit_tokens === undefined) {
      logger.warn('DeepSeek usage missing prompt_cache_hit_tokens; reporting 0 cache hits', {
        projectId: opts.projectId,
        model,
      });
    }

    const tokenUsage: TokenUsage = { inputTokens, outputTokens, cacheHitTokens };
    return {
      text: cleanJsonResponse(text),
      model,
      provider: this.name,
      inputTokens,
      outputTokens,
      cacheHitTokens,
      reasoningTokens,
      costUsd: this.estimateCost(tokenUsage, model),
      fromLocalCache: false,
      latencyMs: 0, // base.complete() overrides with the measured value
    };
  }
}
