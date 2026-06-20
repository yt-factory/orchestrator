import { test, expect, describe } from 'bun:test';
import { selectRecords } from './cost-dump-select';
import type { LLMCallRecord } from '../llm/base/call-log';

function rec(over: Partial<LLMCallRecord>): LLMCallRecord {
  return {
    ts: '2026-06-20T00:00:00.000Z',
    provider: 'deepseek',
    model: 'deepseek-v4-flash',
    tier: 'fast',
    inputTokens: 100,
    outputTokens: 200,
    reasoningTokens: 0,
    cacheHitTokens: 0,
    costUsd: 0.001,
    fromLocalCache: false,
    latencyMs: 0,
    ...over,
  };
}

// Two runs in one append-only log: project A (older), then project B (newer).
const LOG = [
  rec({ projectId: 'A', label: 'topic', ts: '2026-06-20T10:00:00Z' }),
  rec({ projectId: 'A', label: 'faq:zh_TW', ts: '2026-06-20T10:00:01Z' }),
  rec({ projectId: 'B', label: 'topic', ts: '2026-06-20T11:00:00Z' }),
  rec({ projectId: 'B', label: 'faq:zh_TW', ts: '2026-06-20T11:00:01Z' }),
];

describe('selectRecords', () => {
  test('default shows only the latest run (most-recent projectId) — the truncation-trap fix', () => {
    const { records, scope } = selectRecords(LOG, []);
    expect(records).toHaveLength(2);
    expect(records.every((r) => r.projectId === 'B')).toBe(true);
    expect(scope).toContain('project B');
  });

  test('--all shows every run, so an earlier run is never lost', () => {
    const { records } = selectRecords(LOG, ['--all']);
    expect(records).toHaveLength(4);
  });

  test('--project=<id> filters to that project', () => {
    const { records } = selectRecords(LOG, ['--project=A']);
    expect(records).toHaveLength(2);
    expect(records.every((r) => r.projectId === 'A')).toBe(true);
  });

  test('--since=<iso> filters by timestamp', () => {
    const { records } = selectRecords(LOG, ['--since=2026-06-20T11:00:00Z']);
    expect(records).toHaveLength(2);
    expect(records.every((r) => r.projectId === 'B')).toBe(true);
  });
});
