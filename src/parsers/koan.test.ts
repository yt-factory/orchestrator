import { test, expect, describe } from 'bun:test';
import { parseKoan, parseChineseNumber } from './koan';

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
