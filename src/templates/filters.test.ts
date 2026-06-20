import { test, expect, describe } from 'bun:test';
import { renderTagsForLocale } from './filters';

describe('renderTagsForLocale', () => {
  test('zh_TW tags are all Traditional', () => {
    const tags = renderTagsForLocale(['极客禅', '禅宗', '缓存策略'], 'zh_TW');
    expect(tags).toContain('極客禪');
    expect(tags).toContain('禪宗');
    expect(tags).toContain('緩存策略');
    expect(tags.join('')).not.toMatch(/[极禅缓]/); // Simplified-only chars gone
  });

  test('zh_CN_XHS tags are all Simplified', () => {
    const tags = renderTagsForLocale(['極客禪', '禪宗', '緩存策略'], 'zh_CN_XHS');
    expect(tags).toContain('极客禅');
    expect(tags).toContain('禅宗');
    expect(tags).toContain('缓存策略');
    expect(tags.join('')).not.toMatch(/[極禪緩]/); // Traditional-only chars gone
  });

  test('English / brand tags survive locale conversion unchanged', () => {
    expect(renderTagsForLocale(['GeekZen', 'Zen Programming'], 'zh_TW')).toEqual(['GeekZen', 'Zen Programming']);
    expect(renderTagsForLocale(['GeekZen', 'Space-Time Tradeoff'], 'zh_CN_XHS')).toEqual([
      'GeekZen',
      'Space-Time Tradeoff',
    ]);
  });

  test('程式設計師 override -> 程序员 for zh_CN_XHS (opencc default is non-idiomatic)', () => {
    expect(renderTagsForLocale(['程式設計師'], 'zh_CN_XHS')).toEqual(['程序员']);
    expect(renderTagsForLocale(['程式設計師'], 'zh_TW')).toEqual(['程式設計師']);
  });
});
