import { writeFile, readFile } from 'fs/promises';
import type { CostTracking } from '../core/manifest';

// 2026 估算价格 (per 1M tokens)
const TOKEN_PRICES_USD: Record<string, number> = {
  'gemini-2.0-pro': 3.50,
  'gemini-2.0-flash': 0.35,
  'gemini-1.5-flash': 0.10
};

const PERSIST_PATH = './data/cost_report.json';

export class CostTracker {
  private data: CostTracking = {
    total_tokens_used: 0,
    tokens_by_model: {
      'gemini-2.0-pro': 0,
      'gemini-2.0-flash': 0,
      'gemini-1.5-flash': 0
    },
    estimated_cost_usd: 0,
    api_calls_count: 0
  };

  private loaded = false;

  async init(): Promise<void> {
    if (this.loaded) return;
    try {
      const content = await readFile(PERSIST_PATH, 'utf-8');
      this.data = JSON.parse(content);
    } catch {
      // 使用默认值
    }
    this.loaded = true;
  }

  record(model: string, tokens: number): void {
    this.data.total_tokens_used += tokens;
    this.data.api_calls_count += 1;

    if (model in this.data.tokens_by_model) {
      this.data.tokens_by_model[model as keyof typeof this.data.tokens_by_model] += tokens;
    }

    // 计算成本
    const price = TOKEN_PRICES_USD[model] || 0;
    this.data.estimated_cost_usd += (tokens / 1_000_000) * price;

    // 异步保存
    this.saveToDisk().catch(() => {});
  }

  getReport(): CostTracking {
    return { ...this.data };
  }

  getForProject(): CostTracking {
    return {
      total_tokens_used: 0,
      tokens_by_model: {
        'gemini-2.0-pro': 0,
        'gemini-2.0-flash': 0,
        'gemini-1.5-flash': 0
      },
      estimated_cost_usd: 0,
      api_calls_count: 0
    };
  }

  private async saveToDisk(): Promise<void> {
    await writeFile(PERSIST_PATH, JSON.stringify(this.data, null, 2));
  }
}
