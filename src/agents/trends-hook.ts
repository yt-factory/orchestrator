import type { TrendKeyword } from '../core/manifest';
import { readFile, writeFile } from 'fs/promises';
import { logger } from '../utils/logger';
import type { GeminiClient } from './gemini-client';

const CACHE_TTL_HOURS = 6;
const DECAY_THRESHOLD_HOURS = 24;
const PERSIST_PATH = './data/trends_authority.json';

const AUTHORITY_THRESHOLDS = {
  fleeting: 1,
  emerging: 2,
  established: 3
} as const;

interface TrendCacheEntry {
  keyword: string;
  firstSeen: Date;
  lastSeen: Date;
  consecutiveWindows: number;
}

export class TrendsHook {
  private cache: Map<string, TrendCacheEntry> = new Map();
  private loaded = false;

  async init(): Promise<void> {
    if (this.loaded) return;
    await this.loadFromDisk();
    this.loaded = true;
  }

  async getHotKeywords(topic: string, geminiClient: GeminiClient, projectId: string): Promise<TrendKeyword[]> {
    await this.init();

    // Step 1: 应用衰减
    this.applyDecay();

    // Step 2: 从 API 获取新热词
    const rawKeywords = await this.fetchFromTrends(topic, geminiClient, projectId);

    // Step 3: 更新 Authority
    const enrichedKeywords = rawKeywords.map((kw) => this.enrichWithAuthority(kw));

    // Step 4: 持久化
    await this.saveToDisk();

    // Step 5: 排序 (established > emerging > fleeting)
    return enrichedKeywords.sort((a, b) => {
      const order = { established: 0, emerging: 1, fleeting: 2 };
      return order[a.authority] - order[b.authority];
    });
  }

  /**
   * 应用衰减：24小时未出现的关键词降级
   */
  private applyDecay(): void {
    const now = Date.now();

    for (const [keyword, entry] of this.cache.entries()) {
      const hoursSinceLastSeen = (now - entry.lastSeen.getTime()) / (1000 * 60 * 60);

      if (hoursSinceLastSeen > DECAY_THRESHOLD_HOURS) {
        if (entry.consecutiveWindows > 1) {
          entry.consecutiveWindows -= 1;
          logger.info('Trend keyword decayed', {
            keyword,
            newWindows: entry.consecutiveWindows
          });
        } else {
          this.cache.delete(keyword);
          logger.info('Trend removed (fully decayed)', { keyword });
        }
      }
    }
  }

  private enrichWithAuthority(keyword: string): TrendKeyword {
    const now = new Date();
    const existing = this.cache.get(keyword);

    if (existing) {
      const hoursSinceLastUpdate =
        (now.getTime() - existing.lastSeen.getTime()) / (1000 * 60 * 60);

      if (hoursSinceLastUpdate >= CACHE_TTL_HOURS) {
        existing.consecutiveWindows += 1;
      }
      existing.lastSeen = now;

      this.cache.set(keyword, existing);

      const hoursSinceLastSeen =
        (now.getTime() - existing.lastSeen.getTime()) / (1000 * 60 * 60);

      return {
        keyword,
        authority: this.calculateAuthority(existing.consecutiveWindows),
        consecutive_windows: existing.consecutiveWindows,
        first_seen: existing.firstSeen.toISOString(),
        last_seen: existing.lastSeen.toISOString(),
        decay_risk: hoursSinceLastSeen > DECAY_THRESHOLD_HOURS / 2
      };
    }

    // 新关键词
    const entry: TrendCacheEntry = {
      keyword,
      firstSeen: now,
      lastSeen: now,
      consecutiveWindows: 1
    };
    this.cache.set(keyword, entry);

    return {
      keyword,
      authority: 'fleeting',
      consecutive_windows: 1,
      first_seen: now.toISOString(),
      last_seen: now.toISOString(),
      decay_risk: false
    };
  }

  private calculateAuthority(windows: number): TrendKeyword['authority'] {
    if (windows >= AUTHORITY_THRESHOLDS.established) return 'established';
    if (windows >= AUTHORITY_THRESHOLDS.emerging) return 'emerging';
    return 'fleeting';
  }

  /**
   * 获取所有 established 关键词
   */
  getEstablishedKeywords(): string[] {
    return Array.from(this.cache.entries())
      .filter(([_, e]) => e.consecutiveWindows >= AUTHORITY_THRESHOLDS.established)
      .map(([keyword]) => keyword);
  }

  private async loadFromDisk(): Promise<void> {
    try {
      const content = await readFile(PERSIST_PATH, 'utf-8');
      const data = JSON.parse(content);

      for (const [keyword, entry] of Object.entries(data)) {
        const e = entry as Record<string, unknown>;
        this.cache.set(keyword, {
          keyword,
          firstSeen: new Date(e['firstSeen'] as string),
          lastSeen: new Date(e['lastSeen'] as string),
          consecutiveWindows: e['consecutiveWindows'] as number
        });
      }

      logger.info('Trends cache loaded', { count: this.cache.size });
    } catch {
      logger.info('No existing trends cache, starting fresh');
    }
  }

  private async saveToDisk(): Promise<void> {
    const data: Record<string, unknown> = {};

    for (const [keyword, entry] of this.cache.entries()) {
      data[keyword] = {
        keyword: entry.keyword,
        firstSeen: entry.firstSeen.toISOString(),
        lastSeen: entry.lastSeen.toISOString(),
        consecutiveWindows: entry.consecutiveWindows
      };
    }

    await writeFile(PERSIST_PATH, JSON.stringify(data, null, 2));
  }

  /**
   * 通过 Gemini 提取热词（实际生产中替换为 Google Trends API / SerpAPI）
   */
  private async fetchFromTrends(
    topic: string,
    geminiClient: GeminiClient,
    projectId: string
  ): Promise<string[]> {
    const prompt = `Given the topic "${topic}", list 5-10 currently trending keywords or phrases related to this topic that would perform well on YouTube. Focus on search volume and recency.

Output as JSON: { "keywords": string[] }`;

    try {
      const result = await geminiClient.generate(prompt, {
        projectId,
        priority: 'medium'
      });

      const parsed = JSON.parse(result.text);
      const keywords = parsed.keywords;

      if (!Array.isArray(keywords)) {
        logger.warn('Trends response missing keywords array', { projectId });
        return [];
      }

      return keywords as string[];
    } catch (error) {
      logger.warn('Failed to fetch trends, returning empty', {
        projectId,
        error: (error as Error).message
      });
      return [];
    }
  }
}
