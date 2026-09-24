import { test, expect, describe } from 'bun:test';
import { buildKoanTitle, validateTrendCoverage } from './seo-expert';

describe('buildKoanTitle', () => {
  test('new format: "{hook} | {chineseName}" — no English concept segment', () => {
    expect(buildKoanTitle('最深的權衡不是時間', '空間換時間')).toBe(
      '最深的權衡不是時間 | 空間換時間',
    );
  });

  test('empty hook -> title is chineseName alone, no leading " | "', () => {
    expect(buildKoanTitle('', '空間換時間')).toBe('空間換時間');
  });

  test('title has exactly one "|" separator (guard against regressing to the old 3-segment format)', () => {
    const title = buildKoanTitle('hook', '空間換時間');
    expect(title.split('|').length).toBe(2);
  });
});

describe('validateTrendCoverage', () => {
  test('valid when no established trends', () => {
    expect(validateTrendCoverage(['some title'], [])).toEqual({ valid: true, missingTrends: [] });
  });

  test('valid when trend keyword appears in the title', () => {
    const result = validateTrendCoverage(['AI 编程 | 空间换时间'], ['AI 编程']);
    expect(result).toEqual({ valid: true, missingTrends: [] });
  });

  test('invalid when trend keyword is missing from all provided texts', () => {
    const result = validateTrendCoverage(['hook | 空间换时间'], ['AI 编程']);
    expect(result.valid).toBe(false);
    expect(result.missingTrends).toEqual(['AI 编程']);
  });

  test('matches a trend keyword that appears only in the description first line, not the title', () => {
    const title = '最深的權衡不是時間 | 空間換時間';
    const descriptionFirstLine = 'Space-Time Tradeoff —— 本期公案：空間換時間';
    // Keyword only present in the description's English lead-in, absent from the title.
    const result = validateTrendCoverage([title, descriptionFirstLine], ['space-time tradeoff']);
    expect(result.valid).toBe(true);
    expect(result.missingTrends).toEqual([]);
  });

  test('case-insensitive substring match', () => {
    const result = validateTrendCoverage(['hook | Space-Time Tradeoff'], ['SPACE-TIME']);
    expect(result.valid).toBe(true);
  });
});
