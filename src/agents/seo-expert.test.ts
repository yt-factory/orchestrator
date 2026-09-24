import { test, expect, describe } from 'bun:test';
import { buildKoanTitle, validateTrendCoverage } from './seo-expert';

// Straightforward case: chineseName already ends in CJK, so pickTitleTerms
// picks it directly — matches the pre-fix behavior for well-formed koans.
const simpleKoan = { chineseName: '空間換時間', csConceptZh: '空間換時間', csConceptEn: 'Space-Time Tradeoff' };

describe('buildKoanTitle', () => {
  test('new format: "{hook} | {chineseName}" — no English concept segment', () => {
    expect(buildKoanTitle('最深的權衡不是時間', simpleKoan)).toBe(
      '最深的權衡不是時間 | 空間換時間',
    );
  });

  test('empty hook -> title is the picked term alone, no leading " | "', () => {
    expect(buildKoanTitle('', simpleKoan)).toBe('空間換時間');
  });

  test('title has exactly one "|" separator (guard against regressing to the old 3-segment format)', () => {
    const title = buildKoanTitle('hook', simpleKoan);
    expect(title.split('|').length).toBe(2);
  });

  // ep140: H1 held the English term, H2's bracket held the Chinese one —
  // buildKoanTitle must still end in Chinese, not "| Keep-Alive".
  test('ep140-style koan (chineseName is English, csConceptEn is Chinese) ends in Chinese', () => {
    const koan = { chineseName: 'Keep-Alive', csConceptZh: 'Keep-Alive', csConceptEn: '保活' };
    expect(buildKoanTitle('hook', koan)).toBe('hook | 保活');
  });

  // ep116: H2 "SLO（服务水平目标）" — csConceptZh holds the English abbreviation,
  // csConceptEn holds the Chinese phrase (fields reversed from convention).
  test('ep116-style koan (csConceptZh/csConceptEn reversed) ends in Chinese', () => {
    const koan = { chineseName: 'SLO', csConceptZh: 'SLO', csConceptEn: '服务水平目标' };
    expect(buildKoanTitle('hook', koan)).toBe('hook | 服务水平目标');
  });

  // ep108: no bracket in the H2 at all, csConceptEn is ''.
  test('ep108-style koan (no bracket, csConceptEn empty) picks the CJK-suffixed csConceptZh', () => {
    const koan = { chineseName: 'Sidecar', csConceptZh: 'Sidecar模式', csConceptEn: '' };
    expect(buildKoanTitle('hook', koan)).toBe('hook | Sidecar模式');
  });

  // ep106: same reversed-fields pattern as ep116.
  test('ep106-style koan (csConceptZh/csConceptEn reversed) ends in Chinese', () => {
    const koan = { chineseName: 'CQRS', csConceptZh: 'CQRS', csConceptEn: '命令查询分离' };
    expect(buildKoanTitle('hook', koan)).toBe('hook | 命令查询分离');
  });

  test('no CJK term -> hook alone (never ends in English); empty hook falls back to chineseName', () => {
    const koan = { chineseName: 'Foo', csConceptZh: 'Foo', csConceptEn: 'Bar' };
    expect(buildKoanTitle('hook', koan)).toBe('hook');
    expect(buildKoanTitle('', koan)).toBe('Foo');
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
