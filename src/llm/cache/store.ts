// Content-hash cache store (Phase 3).
//
// Layout: .cache/llm/{first-2-chars-of-key}/{key}.json
//         .cache/llm/_index.jsonl   (append-only write log for debugging / cost report)
// The whole .cache dir is gitignored.

import { mkdir, readFile, writeFile, appendFile } from 'fs/promises';
import { join } from 'path';
import { logger } from '../../utils/logger';
import type { CompletionResult, Tier } from '../types';

export interface CacheEntry {
  key: string;
  input_summary: {
    provider: string;
    tier: Tier;
    template_version: number;
  };
  result: CompletionResult;
  created_at: string;
}

export class CacheStore {
  private readonly dir: string;

  constructor(dir?: string) {
    this.dir = dir ?? process.env.LLM_CACHE_DIR ?? '.cache/llm';
  }

  private shardDir(key: string): string {
    return join(this.dir, key.slice(0, 2));
  }

  private fileFor(key: string): string {
    return join(this.shardDir(key), `${key}.json`);
  }

  /** Return the cached entry for a key, or null on miss / unreadable. */
  async load(key: string): Promise<CacheEntry | null> {
    try {
      const raw = await readFile(this.fileFor(key), 'utf-8');
      return JSON.parse(raw) as CacheEntry;
    } catch {
      return null;
    }
  }

  /**
   * Persist an entry and append a line to the index. `costSaved` is what this
   * call cost on the original (miss) run — i.e. what each future hit will save.
   */
  async save(key: string, entry: CacheEntry, costSaved: number): Promise<void> {
    await mkdir(this.shardDir(key), { recursive: true });
    await writeFile(this.fileFor(key), JSON.stringify(entry, null, 2));

    const indexLine = JSON.stringify({
      key,
      provider: entry.input_summary.provider,
      tier: entry.input_summary.tier,
      templateVersion: entry.input_summary.template_version,
      costSaved,
      timestamp: entry.created_at,
    });
    await appendFile(join(this.dir, '_index.jsonl'), `${indexLine}\n`).catch((error) => {
      logger.warn('LLM cache index append failed', { error: String(error) });
    });
  }
}
