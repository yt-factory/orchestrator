// Moved from src/utils/cost-tracker.ts (V2 LLM provider refactor, 2026-06-18).
// Hoisted to llm/base/ as shared provider infrastructure. Logic unchanged.
import { writeFile, readFile } from 'fs/promises';
import type { CostTracking } from '../../core/manifest';
import { logger } from '../../utils/logger';

// 2026 pricing (per 1M tokens, blended input+output estimate)
// Gemini 3.1 Pro: $2/1M input + $12/1M output ≈ $7/1M blended
// Gemini 3 Flash: ~$0.50/1M blended
// Gemini 2.5 Flash: ~$0.15/1M blended
// Blended (input+output) USD per 1M tokens — a rough global estimate only;
// authoritative per-call USD lives in CompletionResult.costUsd.
const TOKEN_PRICES_USD: Record<string, number> = {
  'gemini-3.1-pro-preview': 7.00,
  'gemini-3-pro-preview': 5.00,   // legacy fallback
  'gemini-3-flash': 0.50,
  'gemini-3-flash-preview': 0.50, // legacy fallback
  'gemini-2.5-pro': 1.25,
  'gemini-2.5-flash': 0.15,
  'deepseek-v4-flash': 0.21,      // ~0.14 in + 0.28 out blended
  'deepseek-v4-pro': 0.65         // ~0.435 in + 0.87 out blended
};

const PERSIST_PATH = './data/cost_report.json';

export class CostTracker {
  private data: CostTracking = {
    total_tokens_used: 0,
    tokens_by_model: {},
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

    // Open record: accumulate under whatever model actually ran.
    this.data.tokens_by_model[model] = (this.data.tokens_by_model[model] ?? 0) + tokens;

    // 计算成本
    const price = TOKEN_PRICES_USD[model] || 0;
    this.data.estimated_cost_usd += (tokens / 1_000_000) * price;

    // 异步保存
    this.saveToDisk().catch((error) => {
      logger.error('CostTracker failed to save to disk', { error: String(error) });
    });
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
      tokens_by_model: {},
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

    projectCost.tokens_by_model[model] = (projectCost.tokens_by_model[model] ?? 0) + tokens;

    const price = TOKEN_PRICES_USD[model] || 0;
    projectCost.estimated_cost_usd += (tokens / 1_000_000) * price;

    // Also record to global tracker
    this.record(model, tokens);
  }

  private async saveToDisk(): Promise<void> {
    await writeFile(PERSIST_PATH, JSON.stringify(this.data, null, 2));
  }
}
