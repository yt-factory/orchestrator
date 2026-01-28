import { createPool, Pool } from 'generic-pool';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { TokenBucket } from '../infra/token-bucket';
import { PriorityQueue, type Priority } from '../infra/priority-queue';
import { CostTracker } from '../utils/cost-tracker';
import { logger } from '../utils/logger';
import { withRetry } from '../utils/retry';

// Fallback 模型链
const MODEL_FALLBACK_CHAIN = [
  'gemini-2.0-pro',
  'gemini-2.0-flash',
  'gemini-1.5-flash'
] as const;

type ModelName = (typeof MODEL_FALLBACK_CHAIN)[number];

interface MCPConnection {
  client: Client;
  transport: StdioClientTransport;
  alive: boolean;
}

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
  private pool: Pool<MCPConnection>;
  private tokenBucket: TokenBucket;
  private priorityQueue: PriorityQueue;
  private costTracker: CostTracker;

  constructor(private gatewayCommand: string = 'mcp-gateway') {
    // Token Bucket: 60 requests per minute
    this.tokenBucket = new TokenBucket({
      maxTokens: 60,
      refillRate: 1 // 1 token/sec = 60/min
    });

    this.priorityQueue = new PriorityQueue();
    this.costTracker = new CostTracker();

    this.pool = createPool<MCPConnection>(
      {
        create: async () => this.createConnection(),
        destroy: async (conn) => {
          conn.alive = false;
          await conn.transport.close();
        },
        validate: async (conn) => conn.alive
      },
      {
        max: 5,
        min: 1,
        idleTimeoutMillis: 30_000,
        acquireTimeoutMillis: 10_000
      }
    );
  }

  /**
   * Warm-up: 预建立连接，必须在 FolderWatcher 之前调用
   */
  async warmUp(): Promise<void> {
    logger.info('Warming up connection pool...');
    await this.costTracker.init();
    const conn = await this.pool.acquire();
    await this.pool.release(conn);
    logger.info('Connection pool warmed up successfully');
  }

  /**
   * 主生成方法 (含优先级队列 + Fallback)
   */
  async generate(prompt: string, options: GenerateOptions): Promise<GenerateResult> {
    const { projectId, priority = 'medium', maxRetries = 3 } = options;

    // 加入优先级队列等待
    await this.priorityQueue.enqueue(priority);

    try {
      // Rate limiting
      await this.tokenBucket.acquire();

      const conn = await this.pool.acquire();

      try {
        return await this.generateWithFallback(conn, prompt, projectId, maxRetries);
      } finally {
        await this.pool.release(conn);
      }
    } finally {
      this.priorityQueue.dequeue();
    }
  }

  /**
   * Fallback 链执行 + Prompt 简化
   */
  private async generateWithFallback(
    conn: MCPConnection,
    originalPrompt: string,
    projectId: string,
    retriesPerModel: number
  ): Promise<GenerateResult> {
    for (let modelIdx = 0; modelIdx < MODEL_FALLBACK_CHAIN.length; modelIdx++) {
      const model = MODEL_FALLBACK_CHAIN[modelIdx]!;
      const isFallbackMode = modelIdx > 0;

      // 如果是 Fallback 模式，简化 Prompt
      const prompt = isFallbackMode
        ? this.simplifyPromptForFallback(originalPrompt)
        : originalPrompt;

      try {
        const result = await withRetry(
          () => this.sendViaMCP(conn, prompt, model),
          {
            maxRetries: retriesPerModel,
            baseDelayMs: 1000,
            onRetry: (attempt, error) => {
              logger.warn('Gemini retry', {
                projectId,
                model,
                attempt,
                error: error.message
              });
            }
          }
        );

        // 记录成本
        this.costTracker.record(model, result.tokensUsed);

        logger.info('Gemini generation successful', {
          projectId,
          model,
          isFallbackMode,
          tokensUsed: result.tokensUsed
        });

        return {
          text: result.text,
          modelUsed: model,
          isFallbackMode,
          tokensUsed: result.tokensUsed
        };
      } catch (error) {
        const nextModel = MODEL_FALLBACK_CHAIN[modelIdx + 1];

        logger.error('Model failed', {
          projectId,
          model,
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
   * 通过 MCP 发送请求
   */
  private async sendViaMCP(
    conn: MCPConnection,
    prompt: string,
    model: string
  ): Promise<{ text: string; tokensUsed: number }> {
    const result = await conn.client.callTool({
      name: 'generate',
      arguments: { prompt, model }
    });

    // 解析 MCP 响应
    const content = result.content as Array<{ type: string; text?: string }>;
    const textContent = content.find((c) => c.type === 'text');

    if (!textContent?.text) {
      throw new Error('Empty response from MCP gateway');
    }

    // token 使用量从 meta 中获取，若无则估算
    const tokensUsed =
      (result as Record<string, unknown>)['_meta'] &&
      typeof (result as Record<string, unknown>)['_meta'] === 'object' &&
      (result as Record<string, unknown>)['_meta'] !== null
        ? ((result as Record<string, unknown>)['_meta'] as Record<string, number>)[
            'tokensUsed'
          ] ?? Math.ceil(prompt.length / 4 + textContent.text.length / 4)
        : Math.ceil(prompt.length / 4 + textContent.text.length / 4);

    return {
      text: textContent.text,
      tokensUsed
    };
  }

  /**
   * 简化 Prompt 用于 Fallback 模式
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

  async drain(): Promise<void> {
    await this.pool.drain();
    await this.pool.clear();
    logger.info('Connection pool drained');
  }

  private async createConnection(): Promise<MCPConnection> {
    const transport = new StdioClientTransport({
      command: this.gatewayCommand,
      args: []
    });

    const client = new Client({
      name: 'yt-factory-orchestrator',
      version: '1.0.0'
    });

    await client.connect(transport);

    logger.info('MCP connection created');

    return { client, transport, alive: true };
  }
}
