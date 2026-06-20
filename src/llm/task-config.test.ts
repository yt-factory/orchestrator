import { test, expect, describe } from 'bun:test';
import { maxTokensForTask, TASK_MAX_TOKENS } from './task-config';

describe('maxTokensForTask', () => {
  test('maps a bare task label to its cap', () => {
    expect(maxTokensForTask('faq')).toBe(800);
    expect(maxTokensForTask('title')).toBe(50);
    expect(maxTokensForTask('tags')).toBe(200);
  });

  test('strips a locale suffix and shares the cap', () => {
    expect(maxTokensForTask('faq:zh_TW')).toBe(TASK_MAX_TOKENS.faq);
    expect(maxTokensForTask('description:zh_CN_XHS')).toBe(TASK_MAX_TOKENS.description);
    expect(maxTokensForTask('title:zh_TW')).toBe(50);
  });

  test('returns undefined for unknown or missing labels (no cap)', () => {
    expect(maxTokensForTask('something-else')).toBeUndefined();
    expect(maxTokensForTask(undefined)).toBeUndefined();
    expect(maxTokensForTask('')).toBeUndefined();
  });
});
