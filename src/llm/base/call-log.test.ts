import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { rmSync, existsSync } from 'fs';
import { resetCallLog, appendCallRecord, readCallRecords, type LLMCallRecord } from './call-log';

const TMP_LOG = 'data/_test-llm-calls.jsonl';

function makeRecord(over: Partial<LLMCallRecord> = {}): LLMCallRecord {
  return {
    ts: '2026-06-20T00:00:00.000Z',
    label: 'faq:zh_TW',
    provider: 'deepseek',
    model: 'deepseek-v4-flash',
    tier: 'fast',
    inputTokens: 100,
    outputTokens: 200,
    reasoningTokens: 0,
    cacheHitTokens: 0,
    costUsd: 0.0012,
    fromLocalCache: false,
    latencyMs: 0,
    ...over,
  };
}

describe('call-log', () => {
  beforeEach(() => {
    process.env.LLM_CALL_LOG = TMP_LOG;
    if (existsSync(TMP_LOG)) rmSync(TMP_LOG);
  });

  afterEach(() => {
    if (existsSync(TMP_LOG)) rmSync(TMP_LOG);
    delete process.env.LLM_CALL_LOG;
  });

  test('reads empty when the log does not exist', () => {
    expect(readCallRecords()).toEqual([]);
  });

  test('appends records and reads them back in order', () => {
    appendCallRecord(makeRecord({ label: 'topic' }));
    appendCallRecord(makeRecord({ label: 'faq:zh_CN_XHS', reasoningTokens: 1500 }));

    const records = readCallRecords();
    expect(records).toHaveLength(2);
    expect(records[0]!.label).toBe('topic');
    expect(records[1]!.label).toBe('faq:zh_CN_XHS');
    expect(records[1]!.reasoningTokens).toBe(1500);
  });

  test('resetCallLog truncates prior records', () => {
    appendCallRecord(makeRecord());
    expect(readCallRecords()).toHaveLength(1);

    resetCallLog();
    expect(readCallRecords()).toEqual([]);
  });
});
