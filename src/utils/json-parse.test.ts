import { test, expect, describe } from 'bun:test';
import { parseWithRepair, safeJsonParse, robustJsonParse } from './json-parse';

const ctx = { projectId: 'test', operation: 'test' };

describe('parseWithRepair / safeJsonParse (Layer A)', () => {
  test('clean JSON parses without repair', () => {
    const r = parseWithRepair<{ a: number }>('{"a":1}', ctx);
    expect(r.recovery).toBe('clean');
    expect(r.value).toEqual({ a: 1 });
  });

  test('malformed JSON (ep99-like misplaced brace) is repaired', () => {
    // related_entities written as a sibling of FAQ items instead of a field —
    // bare JSON.parse rejects this; jsonrepair recovers a parseable structure.
    const malformed = `{"faq":[{"q":"a","a":"b"},"related":[]},{"q":"c"}]}`;
    const r = parseWithRepair(malformed, { ...ctx, operation: 'ep99-like' });
    expect(r.recovery).toBe('repaired');
  });

  test('repairs trailing commas, markdown fences, and truncated tails', () => {
    expect(parseWithRepair<{ a: number }>('{"a":1,}', ctx).value).toEqual({ a: 1 });
    expect(parseWithRepair<{ a: number }>('```json\n{"a":1}\n```', ctx).value).toEqual({ a: 1 });
    // truncated (max_tokens cutoff) — jsonrepair closes the open braces
    expect(parseWithRepair<{ faq: unknown[] }>('{"faq":[{"q":"x"', ctx).value.faq).toHaveLength(1);
  });

  test('safeJsonParse returns the value for repairable input (no throw)', () => {
    expect(safeJsonParse<{ a: number }>('{"a":1,}', ctx)).toEqual({ a: 1 });
  });

  test('safeJsonParse throws on genuinely unrepairable input', () => {
    expect(() => safeJsonParse('', ctx)).toThrow();
  });
});

describe('robustJsonParse (Layers A + B + C)', () => {
  test('clean JSON → recovery "clean"', async () => {
    const r = await robustJsonParse('{"a":1}', { operation: 'test', fallback: { a: 0 } });
    expect(r.recovery).toBe('clean');
    expect(r.value).toEqual({ a: 1 });
  });

  test('repairable JSON → recovery "repaired"', async () => {
    const r = await robustJsonParse('{"a":1,}', { operation: 'test', fallback: { a: 0 } });
    expect(r.recovery).toBe('repaired');
    expect(r.value).toEqual({ a: 1 });
  });

  test('unrepairable JSON falls back without retry', async () => {
    const r = await robustJsonParse('', { operation: 'test', fallback: { faq: [] } });
    expect(r.recovery).toBe('fallback');
    expect(r.value).toEqual({ faq: [] });
  });

  test('retry fires once when A fails and succeeds on retry', async () => {
    let calls = 0;
    const r = await robustJsonParse('', {
      operation: 'test',
      fallback: { ok: false },
      retry: async () => {
        calls++;
        return '{"ok":true}';
      },
    });
    expect(calls).toBe(1);
    expect(r.recovery).toBe('retried');
    expect(r.value).toEqual({ ok: true });
  });

  test('retry output is itself repaired before falling back', async () => {
    const r = await robustJsonParse('', {
      operation: 'test',
      fallback: { ok: false },
      retry: async () => '{"ok":true,}', // malformed-but-repairable
    });
    expect(r.recovery).toBe('retried');
    expect(r.value).toEqual({ ok: true });
  });

  test('falls back when retry also returns unrepairable output', async () => {
    const r = await robustJsonParse('', {
      operation: 'test',
      fallback: { faq: [] },
      retry: async () => '',
    });
    expect(r.recovery).toBe('fallback');
    expect(r.value).toEqual({ faq: [] });
  });
});
