import { writeFile, readFile } from 'fs/promises';
import type { CostTracking } from '../core/manifest';

// 2026 估算价格 (per 1M tokens) - Gemini 3 series (preview naming convention)
const TOKEN_PRICES_USD: Record<string, number> = {
  'gemini-3-pro-preview': 5.00,
  'gemini-3-flash-preview': 0.50,
  'gemini-2.5-flash': 0.15
};

const PERSIST_PATH = './data/cost_report.json';

export class CostTracker {
  private data: CostTracking = {
    total_tokens_used: 0,
    tokens_by_model: {
      'gemini-3-pro-preview': 0,
      'gemini-3-flash-preview': 0,
      'gemini-2.5-flash': 0
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

  /**
   * Returns a new empty cost tracking structure for a project
   */
  getForProject(): CostTracking {
    return {
      total_tokens_used: 0,
      tokens_by_model: {
        'gemini-3-pro-preview': 0,
        'gemini-3-flash-preview': 0,
        'gemini-2.5-flash': 0
      },
      estimated_cost_usd: 0,
      api_calls_count: 0
    };
  }

  /**
   * Record usage to a project-specific cost tracking object (mutable)
   */
  recordForProject(projectCost: CostTracking, model: string, tokens: number): void {
    projectCost.total_tokens_used += tokens;
    projectCost.api_calls_count += 1;

    if (model in projectCost.tokens_by_model) {
      projectCost.tokens_by_model[model as keyof typeof projectCost.tokens_by_model] += tokens;
    }

    const price = TOKEN_PRICES_USD[model] || 0;
    projectCost.estimated_cost_usd += (tokens / 1_000_000) * price;

    // Also record to global tracker
    this.record(model, tokens);
  }

  private async saveToDisk(): Promise<void> {
    await writeFile(PERSIST_PATH, JSON.stringify(this.data, null, 2));
  }
}
