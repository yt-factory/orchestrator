// Per-call LLM log — one JSONL line per completion (cache hit or real API call).
//
// The cumulative cost_report.json and the cache _index.jsonl can't answer
// "which call cost what, and did it spend output on reasoning tokens?" — they
// aggregate. This log is the empirical anchor for cost investigation: the
// `make cost-dump` CLI reads it to attribute cost per stage and surface
// thinking-mode output blowups (reasoning_tokens).
//
// The log is APPEND-ONLY: truncating on every process start was destructive — a
// confirmation re-run with no new file would wipe the prior run's data before you
// could read it. Instead each record carries `projectId` + `ts`, and `make
// cost-dump` filters to the latest run (or --project / --since). resetCallLog()
// remains for tests and a manual opt-in reset.

import { appendFileSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import type { Tier } from '../types';

export interface LLMCallRecord {
  ts: string;
  projectId?: string | undefined;
  /** Short stage/operation label (e.g. "faq:zh_TW") for cost attribution. */
  label?: string | undefined;
  provider: string;
  model: string;
  tier: Tier;
  inputTokens: number;
  outputTokens: number;
  /** DeepSeek thinking-mode tokens; 0 when not in thinking mode / unsupported. */
  reasoningTokens: number;
  cacheHitTokens: number;
  costUsd: number;
  fromLocalCache: boolean;
  latencyMs: number;
}

/** Resolved at call time (not module load) so tests can redirect via env. */
export function callLogPath(): string {
  return process.env.LLM_CALL_LOG ?? 'data/llm-calls.jsonl';
}

/** Truncate the log so the next dump reflects only this process's calls. */
export function resetCallLog(): void {
  const path = callLogPath();
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, '');
  } catch {
    // best-effort: cost-dump is a diagnostic, never block the pipeline on it
  }
}

/** Append one call record (best-effort; never throws into the call path). */
export function appendCallRecord(record: LLMCallRecord): void {
  const path = callLogPath();
  try {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, JSON.stringify(record) + '\n');
  } catch {
    // best-effort
  }
}

/** Read all call records from the current log (empty if missing/unreadable). */
export function readCallRecords(): LLMCallRecord[] {
  const path = callLogPath();
  if (!existsSync(path)) return [];
  try {
    return readFileSync(path, 'utf-8')
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as LLMCallRecord);
  } catch {
    return [];
  }
}
