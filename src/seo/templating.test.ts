import { test, expect, describe } from 'bun:test';
import { extractChapters } from './chapters';
import { buildTags, CORE_STATIC_TAGS } from './tags';

describe('extractChapters', () => {
  test('extracts [MM:SS] and [HH:MM:SS] markers', () => {
    const src = 'intro\n[00:00] Opening\nblah\n[02:34] The Question\n[01:02:03] Deep Dive\n';
    expect(extractChapters(src)).toBe('00:00 Opening\n02:34 The Question\n01:02:03 Deep Dive');
  });
  test('extracts unbracketed MM:SS at line start', () => {
    expect(extractChapters('00:00 Intro\n05:30 Body\n')).toBe('00:00 Intro\n05:30 Body');
  });
  test('returns empty string when no timestamp markers (never invents)', () => {
    expect(extractChapters('两个朋友一起来找本源 AI。没有时间标记。')).toBe('');
  });
  test('empty input -> empty string', () => {
    expect(extractChapters('')).toBe('');
  });
});

describe('buildTags', () => {
  const koan = { csConceptZh: '空间换时间', csConceptEn: 'Space-Time Tradeoff' };

  test('includes core static tags + koan concepts + llm suggestions', () => {
    const tags = buildTags(koan, ['recursion', 'algorithms']);
    for (const core of CORE_STATIC_TAGS) expect(tags).toContain(core);
    expect(tags).toContain('空间换时间');
    expect(tags).toContain('Space-Time Tradeoff');
    expect(tags).toContain('recursion');
  });
  test('dedupes', () => {
    const tags = buildTags(koan, ['GeekZen', '空间换时间', 'unique-tag']);
    expect(tags.filter((t) => t === 'GeekZen').length).toBe(1);
    expect(tags.filter((t) => t === '空间换时间').length).toBe(1);
  });
  test('caps at 30', () => {
    const many = Array.from({ length: 40 }, (_, i) => `tag${i}`);
    expect(buildTags(koan, many).length).toBe(30);
  });
  test('drops empty/whitespace concepts', () => {
    const tags = buildTags({ csConceptZh: '禅', csConceptEn: '' }, []);
    expect(tags).not.toContain('');
    expect(tags).toContain('禅');
  });
  test('strips year-stamped tags (P1 guard)', () => {
    const tags = buildTags(koan, [
      'Algorithm Optimization 2025',
      'Space-Time 2024',
      'in 2026',
      'cache strategy', // keep
    ]);
    expect(tags).toContain('cache strategy');
    expect(tags.some((t) => /\b(?:19|20)\d{2}\b/.test(t))).toBe(false);
    expect(tags).not.toContain('Algorithm Optimization 2025');
  });
});
