import { test, expect, describe } from 'bun:test';
import { z } from 'zod';
import {
  coerceEnum,
  defaultIfMissing,
  truncateIfOverflow,
  truncateStringIfOverflow,
  type OnCoerce,
} from './schema-helpers';

const COLORS = ['red', 'green', 'blue'] as const;

// A capturing onCoerce so tests assert coercion fired without grepping logs.
function spy(): { calls: Array<{ message: string; context: Record<string, unknown> }>; fn: OnCoerce } {
  const calls: Array<{ message: string; context: Record<string, unknown> }> = [];
  return { calls, fn: (message, context) => calls.push({ message, context }) };
}

describe('coerceEnum', () => {
  test('valid value passes through unchanged', () => {
    const s = spy();
    expect(coerceEnum(COLORS, 'red', 'color', s.fn).parse('green')).toBe('green');
    expect(s.calls).toHaveLength(0);
  });

  test('invalid value is coerced to the fallback + fires onCoerce', () => {
    const s = spy();
    expect(coerceEnum(COLORS, 'red', 'color', s.fn).parse('purple')).toBe('red');
    expect(s.calls).toHaveLength(1);
    expect(s.calls[0]!.context).toMatchObject({ field: 'color', received: 'purple', coercedTo: 'red' });
  });

  test('missing (undefined) / null / wrong type all coerce to fallback', () => {
    const s = spy();
    const schema = coerceEnum(COLORS, 'blue', 'color', s.fn);
    expect(schema.parse(undefined)).toBe('blue');
    expect(schema.parse(null)).toBe('blue');
    expect(schema.parse(42)).toBe('blue');
    expect(s.calls).toHaveLength(3);
  });
});

describe('defaultIfMissing', () => {
  test('present value passes through', () => {
    const s = spy();
    expect(defaultIfMissing(z.string(), 'x', 'f', s.fn).parse('hi')).toBe('hi');
    expect(s.calls).toHaveLength(0);
  });

  test('missing value becomes the default + fires onCoerce', () => {
    const s = spy();
    expect(defaultIfMissing(z.array(z.string()), [], 'faq.related_entities', s.fn).parse(undefined)).toEqual([]);
    expect(s.calls[0]!.context).toMatchObject({ field: 'faq.related_entities' });
  });
});

describe('truncateIfOverflow', () => {
  test('array within cap passes through', () => {
    const s = spy();
    expect(truncateIfOverflow(z.array(z.string()), 3, 'tags', s.fn).parse(['a', 'b'])).toEqual(['a', 'b']);
    expect(s.calls).toHaveLength(0);
  });

  test('array over cap keeps the first N + fires onCoerce', () => {
    const s = spy();
    expect(truncateIfOverflow(z.array(z.string()), 3, 'tags', s.fn).parse(['a', 'b', 'c', 'd'])).toEqual(['a', 'b', 'c']);
    expect(s.calls[0]!.context).toMatchObject({ field: 'tags', received: 4, max: 3 });
  });
});

describe('truncateStringIfOverflow', () => {
  test('string within cap passes through', () => {
    expect(truncateStringIfOverflow(5, 'answer').parse('hi')).toBe('hi');
  });

  test('string over cap is truncated + fires onCoerce', () => {
    const s = spy();
    expect(truncateStringIfOverflow(5, 'answer', s.fn).parse('abcdefgh')).toBe('abcde');
    expect(s.calls[0]!.context).toMatchObject({ field: 'answer', received: 8, max: 5 });
  });
});

describe('composition — default + truncate (the FAQ answer / related_entities shape)', () => {
  const answer = defaultIfMissing(truncateStringIfOverflow(5, 'answer'), '', 'answer');
  const related = defaultIfMissing(truncateIfOverflow(z.array(z.string()), 2, 'rel'), [], 'rel');

  test('missing -> default', () => {
    expect(answer.parse(undefined)).toBe('');
    expect(related.parse(undefined)).toEqual([]);
  });

  test('present + overflow -> truncated', () => {
    expect(answer.parse('abcdefg')).toBe('abcde');
    expect(related.parse(['a', 'b', 'c'])).toEqual(['a', 'b']);
  });

  test('present + within cap -> unchanged', () => {
    expect(answer.parse('ok')).toBe('ok');
    expect(related.parse(['a'])).toEqual(['a']);
  });
});
