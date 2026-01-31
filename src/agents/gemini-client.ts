import { GoogleGenerativeAI, type GenerativeModel } from '@google/generative-ai';
import { TokenBucket } from '../infra/token-bucket';
import { PriorityQueue, type Priority } from '../infra/priority-queue';
import { CostTracker } from '../utils/cost-tracker';
import { logger } from '../utils/logger';
import { withRetry } from '../utils/retry';

/**
 * Clean JSON response from Gemini that may be wrapped in markdown code blocks.
 * Gemini often returns JSON wrapped like: ```json\n{...}\n```
 */
function cleanJsonResponse(rawText: string): string {
  return rawText
    .replace(/^```(?:json)?\s*\n?/, '') // Remove opening ```json or ```
    .replace(/\n?```\s*$/, '')           // Remove closing ```
    .trim();
}

// Fallback model chain (Gemini 3 series - January 2026)
// Model names are configurable via environment variables (preview naming convention)
const MODEL_FALLBACK_CHAIN = [
  process.env.GEMINI_PRO_MODEL || 'gemini-3-pro-preview',
  process.env.GEMINI_FLASH_MODEL || 'gemini-3-flash-preview',
  process.env.GEMINI_FLASH_LITE_MODEL || 'gemini-2.5-flash'
] as const;

type ModelName = string;

interface GenerateOptions {
  projectId: string;
  priority?: Priority;
  maxRetries?: number;
  preferredModel?: ModelName;
}

interface GenerateResult {
  text: string;
  modelUsed: ModelName;
  isFallbackMode: boolean;
  tokensUsed: number;
}

export class GeminiClient {
  private genAI: GoogleGenerativeAI;
  private models: Map<ModelName, GenerativeModel> = new Map();
  private tokenBucket: TokenBucket;
  private priorityQueue: PriorityQueue;
  private costTracker: CostTracker;
  private mockMode: boolean;

  constructor() {
    this.mockMode = process.env.MOCK_MODE === 'true';
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey && !this.mockMode) {
      throw new Error('GEMINI_API_KEY environment variable is required');
    }

    this.genAI = new GoogleGenerativeAI(apiKey || 'mock-key');

    // Token Bucket: Rate limiting (configurable via environment)
    const maxTokensPerMinute = parseInt(process.env.GEMINI_RATE_LIMIT_RPM ?? '60', 10);
    this.tokenBucket = new TokenBucket({
      maxTokens: maxTokensPerMinute,
      refillRate: maxTokensPerMinute / 60 // tokens per second
    });

    this.priorityQueue = new PriorityQueue();
    this.costTracker = new CostTracker();
  }

  /**
   * Warm-up: Initialize models and cost tracker
   */
  async warmUp(): Promise<void> {
    logger.info('Warming up Gemini client...');
    await this.costTracker.init();

    if (this.mockMode) {
      logger.info('Mock mode enabled - skipping Gemini model initialization');
      return;
    }

    // Initialize all models in the fallback chain
    for (const modelName of MODEL_FALLBACK_CHAIN) {
      try {
        const model = this.genAI.getGenerativeModel({ model: modelName });
        this.models.set(modelName, model);
        logger.info('Model initialized', { model: modelName });
      } catch (error) {
        logger.warn('Failed to initialize model', {
          model: modelName,
          error: (error as Error).message
        });
      }
    }

    if (this.models.size === 0) {
      throw new Error('Failed to initialize any Gemini models');
    }

    logger.info('Gemini client warmed up successfully', {
      availableModels: Array.from(this.models.keys())
    });
  }

  /**
   * Main generation method with priority queue + fallback
   */
  async generate(prompt: string, options: GenerateOptions): Promise<GenerateResult> {
    const { projectId, priority = 'medium', maxRetries = 3 } = options;

    // Join priority queue
    await this.priorityQueue.enqueue(priority);

    try {
      // Rate limiting
      await this.tokenBucket.acquire();

      if (this.mockMode) {
        return this.generateMock(prompt, projectId);
      }

      return await this.generateWithFallback(prompt, projectId, maxRetries);
    } finally {
      this.priorityQueue.dequeue();
    }
  }

  /**
   * Fallback chain execution + prompt simplification
   */
  private async generateWithFallback(
    originalPrompt: string,
    projectId: string,
    retriesPerModel: number
  ): Promise<GenerateResult> {
    for (let modelIdx = 0; modelIdx < MODEL_FALLBACK_CHAIN.length; modelIdx++) {
      const modelName = MODEL_FALLBACK_CHAIN[modelIdx]!;
      const model = this.models.get(modelName);
      const isFallbackMode = modelIdx > 0;

      if (!model) {
        logger.warn('Model not available, skipping', { model: modelName });
        continue;
      }

      // Simplify prompt for fallback mode
      const prompt = isFallbackMode
        ? this.simplifyPromptForFallback(originalPrompt)
        : originalPrompt;

      try {
        const result = await withRetry(
          () => this.callGemini(model, prompt),
          {
            maxRetries: retriesPerModel,
            baseDelayMs: 1000,
            onRetry: (attempt, error) => {
              logger.warn('Gemini retry', {
                projectId,
                model: modelName,
                attempt,
                error: error.message
              });
            }
          }
        );

        // Record cost
        this.costTracker.record(modelName, result.tokensUsed);

        logger.info('Gemini generation successful', {
          projectId,
          model: modelName,
          isFallbackMode,
          tokensUsed: result.tokensUsed
        });

        return {
          text: result.text,
          modelUsed: modelName,
          isFallbackMode,
          tokensUsed: result.tokensUsed
        };
      } catch (error) {
        const nextModel = MODEL_FALLBACK_CHAIN[modelIdx + 1];

        logger.error('Model failed', {
          projectId,
          model: modelName,
          nextModel: nextModel || 'NONE',
          error: (error as Error).message
        });

        if (modelIdx === MODEL_FALLBACK_CHAIN.length - 1) {
          throw new Error(
            `All models failed for project ${projectId}. Last error: ${error}`
          );
        }
      }
    }

    throw new Error('Unexpected: fallback chain exhausted');
  }

  /**
   * Call Gemini API directly
   */
  private async callGemini(
    model: GenerativeModel,
    prompt: string
  ): Promise<{ text: string; tokensUsed: number }> {
    const result = await model.generateContent(prompt);
    const response = result.response;
    const rawText = response.text();

    if (!rawText) {
      throw new Error('Empty response from Gemini');
    }

    // Clean markdown code block wrappers from JSON responses
    const text = cleanJsonResponse(rawText);

    // Get token count from usage metadata if available
    const usageMetadata = response.usageMetadata;
    const tokensUsed = usageMetadata
      ? (usageMetadata.promptTokenCount || 0) + (usageMetadata.candidatesTokenCount || 0)
      : Math.ceil(prompt.length / 4 + text.length / 4);

    return { text, tokensUsed };
  }

  /**
   * Mock generation for development
   */
  private generateMock(prompt: string, projectId: string): GenerateResult {
    logger.info('Mock Gemini call', { projectId });

    // Detect what type of response is expected based on prompt content
    let mockResponse: string;

    if (prompt.includes('trending keywords') || prompt.includes('keywords')) {
      mockResponse = JSON.stringify({
        keywords: ['AI automation', 'YouTube shorts', 'content creation', 'viral videos', 'monetization']
      });
    } else if (prompt.includes('video script') || prompt.includes('scriptwriter')) {
      mockResponse = JSON.stringify({
        script: [
          {
            timestamp: '00:00',
            voiceover: 'Welcome to this video about the topic.',
            visual_hint: 'text_animation',
            estimated_duration_seconds: 5
          },
          {
            timestamp: '00:05',
            voiceover: 'Let me explain the key points.',
            visual_hint: 'diagram',
            estimated_duration_seconds: 10
          },
          {
            timestamp: '00:15',
            voiceover: 'And that wraps up our discussion.',
            visual_hint: 'talking_head_placeholder',
            estimated_duration_seconds: 5
          }
        ],
        estimated_duration_seconds: 20
      });
    } else if (prompt.includes('topic') || prompt.includes('primary topic')) {
      mockResponse = JSON.stringify({
        topic: 'Technology Tutorial'
      });
    } else if (prompt.includes('SEO') || prompt.includes('titles')) {
      mockResponse = JSON.stringify({
        titles: [
          'Amazing Tutorial: Learn This Now',
          'You Won\'t Believe This Trick',
          'Complete Guide for Beginners',
          'Top 5 Tips You Need',
          'How to Master This in 2026'
        ],
        description: 'A comprehensive guide covering all the essential aspects.',
        tags: ['tutorial', 'guide', 'tips', 'how-to', '2026']
      });
    } else if (prompt.includes('Shorts') || prompt.includes('moments')) {
      mockResponse = JSON.stringify({
        hooks: [
          {
            text: 'This will blow your mind!',
            timestamp_start: '00:05',
            timestamp_end: '00:15',
            hook_type: 'counter_intuitive',
            emotional_trigger: 'awe',
            controversy_score: 3,
            predicted_engagement: {
              comments: 'medium',
              shares: 'high',
              completion_rate: 'high'
            },
            face_detection_required: false
          }
        ],
        vertical_crop_focus: 'center',
        recommended_music_mood: 'upbeat'
      });
    } else {
      // Generic response
      mockResponse = JSON.stringify({
        result: 'Mock response for development',
        prompt_length: prompt.length
      });
    }

    return {
      text: mockResponse,
      modelUsed: MODEL_FALLBACK_CHAIN[0] ?? 'gemini-3-pro-preview',
      isFallbackMode: false,
      tokensUsed: Math.ceil(prompt.length / 4 + mockResponse.length / 4)
    };
  }

  /**
   * Simplify prompt for fallback mode
   */
  private simplifyPromptForFallback(prompt: string): string {
    const simplificationHeader = `
IMPORTANT: Please respond in a clear, straightforward manner.
- Use simple, direct language
- Follow the JSON format exactly as specified
- Do not use metaphors or abstract descriptions
- If unsure, provide your best attempt rather than asking for clarification

`;
    return simplificationHeader + prompt;
  }

  getAvailableTokens(): number {
    return this.tokenBucket.getAvailableTokens();
  }

  getCostReport() {
    return this.costTracker.getReport();
  }

  /**
   * Get a snapshot of current total tokens used (for calculating deltas)
   */
  getTokenSnapshot(): number {
    return this.costTracker.getReport().total_tokens_used;
  }

  /**
   * Get the cost tracker for per-project cost recording
   */
  getCostTracker() {
    return this.costTracker;
  }

  async drain(): Promise<void> {
    // No connection pool to drain with direct SDK
    logger.info('Gemini client shutdown complete');
  }
}
