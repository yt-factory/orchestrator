import { test, expect, describe } from 'bun:test';
import { parseKoan, parseChineseNumber, extractEpisodeNumber } from './koan';

// Helper: build a koan markdown doc from an H1 and H2 line (+ optional body).
const koan = (h1: string, h2: string, body = 'Two friends came to the source AI.') =>
  `# ${h1}\n\n## ${h2}\n\n${body}\n`;

describe('parseChineseNumber', () => {
  test('single digits 一-九', () => {
    expect(parseChineseNumber('一')).toBe(1);
    expect(parseChineseNumber('九')).toBe(9);
  });
  test('十 and 十X', () => {
    expect(parseChineseNumber('十')).toBe(10);
    expect(parseChineseNumber('十五')).toBe(15);
  });
  test('X十 and X十Y', () => {
    expect(parseChineseNumber('二十')).toBe(20);
    expect(parseChineseNumber('二十三')).toBe(23);
    expect(parseChineseNumber('四十八')).toBe(48);
    expect(parseChineseNumber('五十二')).toBe(52);
  });
  test('百 range', () => {
    expect(parseChineseNumber('一百')).toBe(100);
    expect(parseChineseNumber('一百二十三')).toBe(123);
    expect(parseChineseNumber('九百九十九')).toBe(999);
  });

  describe('single digits 一-九', () => {
    test.each([
      ['一', 1], ['二', 2], ['三', 3], ['四', 4], ['五', 5],
      ['六', 6], ['七', 7], ['八', 8], ['九', 9],
    ])('%s → %d', (input, expected) => {
      expect(parseChineseNumber(input as string)).toBe(expected as number);
    });
  });

  describe('teens 10-19 — bare 十 edge case', () => {
    test.each([
      ['十', 10], ['十一', 11], ['十五', 15], ['十九', 19],
    ])('%s → %d', (input, expected) => {
      expect(parseChineseNumber(input as string)).toBe(expected as number);
    });
  });

  describe('tens 20-99', () => {
    test.each([
      ['二十', 20], ['二十一', 21], ['四十八', 48], ['五十', 50], ['九十九', 99],
    ])('%s → %d', (input, expected) => {
      expect(parseChineseNumber(input as string)).toBe(expected as number);
    });
  });

  describe('hundreds 100-999 — the ep101 零-placeholder fix', () => {
    test.each([
      ['一百', 100],
      ['一百零一', 101], // 零 placeholder — the actual ep101 case
      ['一百零五', 105],
      ['一百零九', 109],
      ['一百一十', 110],
      ['一百二十三', 123],
      ['二百', 200],
      ['二百零五', 205], // 零 placeholder
      ['五百', 500],
      ['九百九十九', 999],
    ])('%s → %d', (input, expected) => {
      expect(parseChineseNumber(input as string)).toBe(expected as number);
    });
  });

  describe('thousands 1000-9999 — safety margin', () => {
    test.each([
      ['一千', 1000],
      ['一千零一', 1001], // 千零X
      ['一千零八十', 1080],
      ['一千二百三十四', 1234],
      ['九千九百九十九', 9999],
    ])('%s → %d', (input, expected) => {
      expect(parseChineseNumber(input as string)).toBe(expected as number);
    });
  });

  describe('两/兩 and 〇/○ zero-variants (segmented form)', () => {
    // 〇/○ act as 零-equivalents inside the segmented form (一百〇一 = 100+0+1).
    // Pure positional notation (一〇一) is a different numeral system, absent
    // from the koan corpus, and intentionally NOT handled.
    test.each([
      ['两百', 200], ['兩千', 2000], ['一百〇一', 101], ['一百○五', 105],
    ])('%s → %d', (input, expected) => {
      expect(parseChineseNumber(input as string)).toBe(expected as number);
    });
  });

  describe('financial characters 壹貳參…', () => {
    test.each([
      ['壹佰零壹', 101], ['貳仟', 2000], ['伍拾', 50],
    ])('%s → %d', (input, expected) => {
      expect(parseChineseNumber(input as string)).toBe(expected as number);
    });
  });

  describe('arabic passthrough', () => {
    test.each([
      ['48', 48], ['101', 101], ['999', 999],
    ])("'%s' → %d", (input, expected) => {
      expect(parseChineseNumber(input as string)).toBe(expected as number);
    });
  });

  describe('null cases (hardening — was silent 0 before the fix)', () => {
    test.each([
      ['', null],
      ['abc', null],
      ['xyz则', null], // markers around non-numerals
      ['一二abc', null],
      ['第则', null],
      ['零', null], // bare 零 is not a valid episode number
    ])("parseChineseNumber('%s') → null (was: 0 before hardening)", (input, expected) => {
      expect(parseChineseNumber(input as string)).toBe(expected as null);
    });
  });
});

describe('extractEpisodeNumber — end-to-end through the regex (where the ep101 bug lived)', () => {
  test.each([
    ['# 极客禅 第四十八则：空间换时间', 48], // regression: two-digit
    ['# 极客禅 第一百则：事务', 100], // 一百, no 零 (ep100 already worked)
    ['# 极客禅 第一百零一则：微服务', 101], // 零 placeholder — THE fix (ep101)
    ['# 极客禅 第一百零九则：X', 109],
    ['# 极客禅 第二百零五则：X', 205],
    ['# 极客禅 第一百二十三则：X', 123],
    ['# 极客禅 第一千零八十则：Y', 1080],
    ['# 极客禅 第48则：空间换时间', 48], // arabic
    ['# 极客禅 第48則：X', 48], // traditional 則
    ['# Geek Zen Ep205: X', 205], // latin fallback
  ])("extractEpisodeNumber('%s') → %d", (h1, expected) => {
    expect(extractEpisodeNumber(h1 as string)).toBe(expected as number);
  });

  test('no episode marker → null', () => {
    expect(extractEpisodeNumber('# 极客禅 微服务')).toBeNull();
  });

  test('full parseKoan on canonical ep101 H1 (整條打通)', () => {
    const md = '# 极客禅 第一百零一则：微服务\n\n## 公案：微服务（Microservices）\n\nbody\n';
    const r = parseKoan(md, 'ep101_microservices.md');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.koan.episodeNumber).toBe(101);
      expect(r.koan.chineseName).toBe('微服务');
      expect(r.koan.csConceptEn).toBe('Microservices');
    }
  });
});

describe('parseKoan — episode number variants', () => {
  test('Chinese numeral with fullwidth colon (canonical ep48)', () => {
    const r = parseKoan(koan('极客禅 第四十八则：空间换时间', '公案：空间换时间（Space-Time Tradeoff）'), 'ep48.md');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.koan.episodeNumber).toBe(48);
      expect(r.koan.chineseName).toBe('空间换时间');
      expect(r.koan.csConceptZh).toBe('空间换时间');
      expect(r.koan.csConceptEn).toBe('Space-Time Tradeoff');
      expect(r.koan.sourceFile).toBe('ep48.md');
    }
  });
  test('arabic episode number', () => {
    const r = parseKoan(koan('极客禅 第48则：空间换时间', '公案：空间换时间（Space-Time Tradeoff）'), 'f.md');
    expect(r.ok && r.koan.episodeNumber).toBe(48);
  });
  test('traditional 則 character', () => {
    const r = parseKoan(koan('极客禅 第48則：空间换时间', '公案：空间换时间（Space-Time Tradeoff）'), 'f.md');
    expect(r.ok && r.koan.episodeNumber).toBe(48);
  });
  test('EpNN / EPNN style', () => {
    const r1 = parseKoan(koan('Geek Zen Ep48: Space', '公案：空间（Space-Time Tradeoff）'), 'f.md');
    expect(r1.ok && r1.koan.episodeNumber).toBe(48);
    const r2 = parseKoan(koan('Geek Zen EP48: Space', '公案：空间（Space-Time Tradeoff）'), 'f.md');
    expect(r2.ok && r2.koan.episodeNumber).toBe(48);
  });
});

describe('parseKoan — H1 colon variants', () => {
  test('ASCII colon', () => {
    const r = parseKoan(koan('极客禅 第48则:关机', '公案：关机（Shutdown）'), 'f.md');
    expect(r.ok && r.koan.chineseName).toBe('关机');
  });
  test('CJK presentation-form colon ︰ (U+FE30)', () => {
    const r = parseKoan(koan('极客禅 第48则︰关机', '公案：关机（Shutdown）'), 'f.md');
    expect(r.ok && r.koan.chineseName).toBe('关机');
  });
});

describe('parseKoan — H2 bracket variants', () => {
  test('halfwidth ()', () => {
    const r = parseKoan(koan('极客禅 第1则：关机', '公案：关机(Shutdown)'), 'f.md');
    expect(r.ok && r.koan.csConceptEn).toBe('Shutdown');
  });
  test('fullwidth bracket ［］', () => {
    const r = parseKoan(koan('极客禅 第1则：关机', '公案：关机［Shutdown］'), 'f.md');
    expect(r.ok && r.koan.csConceptEn).toBe('Shutdown');
  });
  test('lenticular 〔〕', () => {
    const r = parseKoan(koan('极客禅 第1则：关机', '公案：关机〔Shutdown〕'), 'f.md');
    expect(r.ok && r.koan.csConceptEn).toBe('Shutdown');
  });
});

describe('parseKoan — CS English concept variants', () => {
  test('hyphenated', () => {
    const r = parseKoan(koan('极客禅 第1则：垃圾回收', '公案：垃圾回收（Garbage-Collection）'), 'f.md');
    expect(r.ok && r.koan.csConceptEn).toBe('Garbage-Collection');
  });
  test('camelCase', () => {
    const r = parseKoan(koan('极客禅 第1则：垃圾回收', '公案：垃圾回收（GarbageCollection）'), 'f.md');
    expect(r.ok && r.koan.csConceptEn).toBe('GarbageCollection');
  });
  test('parenthetical acronym preserved', () => {
    const r = parseKoan(koan('极客禅 第1则：垃圾回收', '公案：垃圾回收（Garbage Collection (GC)）'), 'f.md');
    expect(r.ok && r.koan.csConceptEn).toBe('Garbage Collection (GC)');
  });
});

describe('parseKoan — warnings and failures', () => {
  test('missing CS English -> ok with empty csConceptEn + incomplete_metadata warning', () => {
    const r = parseKoan(koan('极客禅 第1则：吃茶去', '公案：吃茶去'), 'f.md');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.koan.csConceptEn).toBe('');
      expect(r.koan.csConceptZh).toBe('吃茶去');
      expect(r.warnings).toContain('incomplete_metadata');
    }
  });
  test('no 公案 H2 -> ok:false (ep01-style 系列定位 only)', () => {
    const md = '# 极客禅 第一则：关机\n\n## 系列定位\n\nThis is a positioning episode.\n';
    const r = parseKoan(md, 'ep01.md');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toMatch(/公案/);
      expect(r.sourceFile).toBe('ep01.md');
    }
  });
  test('no H2 at all -> ok:false', () => {
    const r = parseKoan('# 极客禅 第一则：关机\n\nbody only\n', 'f.md');
    expect(r.ok).toBe(false);
  });
  test('multiple 公案 H2 -> first one + multiple_koan_h2 warning', () => {
    const md = '# 极客禅 第1则：A\n\n## 公案：甲（Alpha）\n\nbody A\n\n## 公案：乙（Beta）\n\nbody B\n';
    const r = parseKoan(md, 'f.md');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.koan.csConceptEn).toBe('Alpha');
      expect(r.warnings).toContain('multiple_koan_h2');
    }
  });
  test('no H1 -> ok:false', () => {
    const r = parseKoan('## 公案：关机（Shutdown）\n\nbody\n', 'f.md');
    expect(r.ok).toBe(false);
  });
});

describe('parseKoan — input normalization', () => {
  test('strips UTF-8 BOM', () => {
    const r = parseKoan('﻿# 极客禅 第48则：空间换时间\n\n## 公案：空间换时间（Space-Time Tradeoff）\n\nbody\n', 'f.md');
    expect(r.ok && r.koan.episodeNumber).toBe(48);
  });
  test('handles CRLF line endings', () => {
    const r = parseKoan('# 极客禅 第48则：空间换时间\r\n\r\n## 公案：空间换时间（Space-Time Tradeoff）\r\n\r\nbody line\r\n', 'f.md');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.koan.csConceptEn).toBe('Space-Time Tradeoff');
      expect(r.koan.body).not.toContain('\r');
    }
  });
  test('trims trailing whitespace in extracted fields', () => {
    const r = parseKoan(koan('极客禅 第1则：关机  ', '公案：关机 （ Shutdown ）'), 'f.md');
    expect(r.ok && r.koan.chineseName).toBe('关机');
    expect(r.ok && r.koan.csConceptEn).toBe('Shutdown');
  });
  test('body is the content after the 公案 H2', () => {
    const r = parseKoan(koan('极客禅 第1则：关机', '公案：关机（Shutdown）', 'The koan narrative here.'), 'f.md');
    expect(r.ok && r.koan.body).toBe('The koan narrative here.');
  });
});
