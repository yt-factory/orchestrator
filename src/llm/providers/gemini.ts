// GeminiProvider — tier-aware wrapper over @google/generative-ai.
//
// Replaces direct GeminiClient.generate() for all pipeline (non-NotebookLM)
// call sites. Reuses the same SDK and the shared base orchestration; the key
// change is that the model is chosen from the requested cost tier rather than
// always running the most expensive model.
//
// Tier mapping (V2 Phase 2 — NO gemini-3-pro-preview, that was the cost hole):
//   fast  -> gemini-2.5-flash   (structured extraction, ranking, short hooks)
//   smart -> gemini-2.5-pro     (creative copy, scripts)

import { GoogleGenerativeAI, type GenerativeModel } from '@google/generative-ai';
import { BaseLLMProvider } from '../base/provider';
import type { CostTracker } from '../base/cost-tracker';
import { logger } from '../../utils/logger';
import { withRetry } from '../../utils/retry';
import type { CompleteOptions, CompletionResult, Tier, TokenUsage } from '../types';

/** Blended USD per 1M tokens. Estimates — Gemini is the fallback provider, so
 *  these are not the verified figures DeepSeek got. Revisit if Gemini becomes
 *  primary. Mirrors the cost-tracker.ts blended convention. */
const GEMINI_BLENDED_USD_PER_M: Record<string, number> = {
  'gemini-2.5-flash': 0.15,
  'gemini-2.5-pro': 1.25,
};

/** Strip ```json fences Gemini sometimes wraps JSON responses in. */
function cleanJsonResponse(rawText: string): string {
  return rawText
    .replace(/^```(?:json)?\s*\n?/, '')
    .replace(/\n?```\s*$/, '')
    .trim();
}

export class GeminiProvider extends BaseLLMProvider {
  private readonly genAI: GoogleGenerativeAI;
  private readonly mockMode: boolean;

  constructor(config: { costTracker?: CostTracker } = {}) {
    super({
      name: 'gemini',
      rateLimitRpm: parseInt(
        process.env.GEMINI_RATE_LIMIT_RPM ?? process.env.LLM_RATE_LIMIT_RPM ?? '60',
        10,
      ),
      circuitBreaker: {
        failureThreshold: parseInt(process.env.GEMINI_CIRCUIT_BREAKER_THRESHOLD ?? '5', 10),
        resetTimeoutMs: parseInt(process.env.GEMINI_CIRCUIT_BREAKER_RESET_MS ?? '30000', 10),
        successThreshold: 2,
      },
      ...(config.costTracker ? { costTracker: config.costTracker } : {}),
    });

    this.mockMode = process.env.MOCK_MODE === 'true';
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey && !this.mockMode) {
      throw new Error('GEMINI_API_KEY environment variable is required');
    }
    this.genAI = new GoogleGenerativeAI(apiKey || 'mock-key');
  }

  protected resolveModel(tier: Tier): string {
    return tier === 'smart'
      ? (process.env.GEMINI_SMART_MODEL ?? 'gemini-2.5-pro')
      : (process.env.GEMINI_FAST_MODEL ?? 'gemini-2.5-flash');
  }

  protected estimateCost(usage: TokenUsage, model: string): number {
    const perM = GEMINI_BLENDED_USD_PER_M[model] ?? 0;
    return ((usage.inputTokens + usage.outputTokens) / 1_000_000) * perM;
  }

  protected async _doComplete(
    systemPrompt: string,
    userContent: string,
    opts: CompleteOptions,
  ): Promise<CompletionResult> {
    const model = this.resolveModel(opts.tier);

    if (this.mockMode) {
      return this.mockComplete(systemPrompt, userContent, model);
    }

    const genModel = this.genAI.getGenerativeModel({
      model,
      ...(systemPrompt ? { systemInstruction: systemPrompt } : {}),
      generationConfig: {
        ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
        ...(opts.maxTokens !== undefined ? { maxOutputTokens: opts.maxTokens } : {}),
        ...(opts.jsonMode ? { responseMimeType: 'application/json' } : {}),
      },
    });

    const timeoutMs = parseInt(process.env.GEMINI_API_TIMEOUT_MS ?? '120000', 10);

    const usage = await withRetry(
      () => this.callOnce(genModel, userContent, timeoutMs),
      {
        maxRetries: opts.maxRetries ?? 3,
        baseDelayMs: 1000,
        onRetry: (attempt, error) => {
          logger.warn('Gemini provider retry', {
            projectId: opts.projectId,
            model,
            attempt,
            error: error.message,
          });
        },
      },
    );

    return {
      text: usage.text,
      model,
      provider: this.name,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheHitTokens: usage.cacheHitTokens,
      costUsd: this.estimateCost(usage, model),
      fromLocalCache: false,
      latencyMs: 0, // base.complete() overrides with the measured value
    };
  }

  /** One raw API call with timeout protection; returns text + token usage. */
  private async callOnce(
    genModel: GenerativeModel,
    userContent: string,
    timeoutMs: number,
  ): Promise<TokenUsage & { text: string }> {
    let timeoutHandle: ReturnType<typeof setTimeout>;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(
        () => reject(new Error(`Gemini API call timed out after ${timeoutMs}ms`)),
        timeoutMs,
      );
    });

    const result = await Promise.race([
      genModel.generateContent(userContent),
      timeoutPromise,
    ]).finally(() => clearTimeout(timeoutHandle));

    const response = result.response;
    const rawText = response.text();
    if (!rawText) {
      throw new Error('Empty response from Gemini');
    }
    const text = cleanJsonResponse(rawText);

    const meta = response.usageMetadata;
    const inputTokens = meta?.promptTokenCount ?? Math.ceil(userContent.length / 4);
    const outputTokens = meta?.candidatesTokenCount ?? Math.ceil(text.length / 4);
    const cacheHitTokens = meta?.cachedContentTokenCount ?? 0;

    return { text, inputTokens, outputTokens, cacheHitTokens };
  }

  /** Mock path for MOCK_MODE=true (content-sniffing parity with GeminiClient). */
  private mockComplete(
    systemPrompt: string,
    userContent: string,
    model: string,
  ): CompletionResult {
    const prompt = `${systemPrompt}\n${userContent}`;
    let text: string;

    // Order matters: branches that EMBED other content (the shorts prompt embeds
    // the generated script; the script prompt embeds raw content) must be matched
    // by their most-specific marker first, before generic tokens like "topic".
    if (prompt.includes('hook_paragraph')) {
      text = JSON.stringify({ hook_paragraph: '在程式的世界裡，我們總在尋找平衡。慢下來，也許答案就在眼前。' });
    } else if (prompt.includes('hook phrase')) {
      text = JSON.stringify({ hook: '当代码遇见禅' });
    } else if (prompt.includes('supplement an existing tag')) {
      text = JSON.stringify({ tags: ['mock-tag-a', 'mock-tag-b', 'mock-tag-c'] });
    } else if (prompt.includes('related_entities')) {
      // FAQ prompt (checked before titles/description: it also says "description").
      text = JSON.stringify({ faq: [
        { question: '什麼是空間換時間？', answer: '用更多記憶體換取更快的運算。', related_entities: ['cache'] },
        { question: '為什麼重要？', answer: '它是系統設計的核心權衡。', related_entities: ['system design'] },
      ] });
    } else if (prompt.includes('Shorts') || prompt.includes('best moments')) {
      text = JSON.stringify({
        hooks: [{ text: 'This will blow your mind!', timestamp_start: '00:05', timestamp_end: '00:15', hook_type: 'counter_intuitive', emotional_trigger: 'awe', controversy_score: 3, predicted_engagement: { comments: 'medium', shares: 'high', completion_rate: 'high' }, face_detection_required: false }],
        vertical_crop_focus: 'center',
        recommended_music_mood: 'upbeat',
      });
    } else if (prompt.includes('video script') || prompt.includes('scriptwriter')) {
      text = JSON.stringify({
        script: [
          { timestamp: '00:00', voiceover: 'Welcome to this video about the topic.', visual_hint: 'text_animation', estimated_duration_seconds: 5 },
          { timestamp: '00:05', voiceover: 'Let me explain the key points.', visual_hint: 'diagram', estimated_duration_seconds: 10 },
          { timestamp: '00:15', voiceover: 'And that wraps up our discussion.', visual_hint: 'talking_head_placeholder', estimated_duration_seconds: 5 },
        ],
        estimated_duration_seconds: 20,
      });
    } else if (prompt.includes('titles') || prompt.includes('description')) {
      // Checked before "trending keywords": the title personas mention
      // "trending keywords", but this is a title/description request.
      text = JSON.stringify({
        titles: ['Amazing Tutorial: Learn This Now', "You Won't Believe This Trick", 'Complete Guide for Beginners', 'Top 5 Tips You Need', 'How to Master This in 2026'],
        description: 'A comprehensive guide covering all the essential aspects.',
        tags: ['tutorial', 'guide', 'tips', 'how-to', '2026'],
      });
    } else if (prompt.includes('trending keywords')) {
      text = JSON.stringify({
        keywords: ['AI automation', 'YouTube shorts', 'content creation', 'viral videos', 'monetization'],
      });
    } else if (prompt.includes('primary topic')) {
      text = JSON.stringify({ topic: 'Technology Tutorial' });
    } else {
      text = JSON.stringify({ result: 'Mock response for development', prompt_length: prompt.length });
    }

    const inputTokens = Math.ceil(prompt.length / 4);
    const outputTokens = Math.ceil(text.length / 4);
    return {
      text,
      model,
      provider: this.name,
      inputTokens,
      outputTokens,
      cacheHitTokens: 0,
      costUsd: this.estimateCost({ inputTokens, outputTokens, cacheHitTokens: 0 }, model),
      fromLocalCache: false,
      latencyMs: 0,
    };
  }
}
