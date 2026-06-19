// Koan markdown parser (Phase 5).
//
// Koan files carry their metadata in the heading lines rather than frontmatter:
//   # 极客禅 第四十八则：空间换时间          <- episode number + Chinese name
//   ## 公案：空间换时间（Space-Time Tradeoff） <- CS concept (zh + en)
//
// Parsing never throws: failures and warnings are returned as data so a
// 480-file batch run can report problems and keep going.

export interface ParsedKoan {
  episodeNumber: number;
  chineseName: string; // from H1, after the colon
  csConceptZh: string; // from the 公案 H2, before the bracket
  csConceptEn: string; // from the 公案 H2 bracket; '' if absent
  body: string; // markdown body after the 公案 H2
  rawTitle: string; // original H1 text (after '# '), for traceability
  sourceFile: string;
}

export type ParseResult =
  | { ok: true; koan: ParsedKoan; warnings: string[] }
  | { ok: false; sourceFile: string; reason: string; rawH1?: string; rawH2?: string };

const CN_DIGITS: Record<string, number> = {
  一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
};

/** Convert a Chinese numeral (一-九百九十九 range) to an integer. */
export function parseChineseNumber(input: string): number {
  let total = 0;
  let section = 0;
  for (const ch of input) {
    const digit = CN_DIGITS[ch];
    if (digit !== undefined) {
      section = digit;
    } else if (ch === '十') {
      section = (section === 0 ? 1 : section) * 10;
      total += section;
      section = 0;
    } else if (ch === '百') {
      section = (section === 0 ? 1 : section) * 100;
      total += section;
      section = 0;
    } else if (ch === '千') {
      section = (section === 0 ? 1 : section) * 1000;
      total += section;
      section = 0;
    }
  }
  return total + section;
}

const COLON = /[：:︰]/; // fullwidth, ASCII, CJK presentation-form
const OPEN_BRACKET = '（(［〔';
const CLOSE_BRACKET = '）)］〕';
const KOAN_H2 = new RegExp(`^公案${COLON.source}`);

function extractEpisodeNumber(h1: string): number | null {
  const arabic = h1.match(/第\s*(\d+)\s*[则則]/);
  if (arabic) return parseInt(arabic[1]!, 10);
  const chinese = h1.match(/第\s*([一二三四五六七八九十百千]+)\s*[则則]/);
  if (chinese) return parseChineseNumber(chinese[1]!);
  const latin = h1.match(/[Ee][Pp]\s*(\d+)/);
  if (latin) return parseInt(latin[1]!, 10);
  return null;
}

export function parseKoan(markdown: string, sourceFile: string): ParseResult {
  // Normalize: strip BOM, CRLF -> LF.
  const text = markdown.replace(/^﻿/, '').replace(/\r\n/g, '\n');
  const lines = text.split('\n');

  // --- H1: episode number + Chinese name ---
  const h1Line = lines.find((l) => /^#\s+/.test(l));
  if (!h1Line) {
    return { ok: false, sourceFile, reason: 'no H1 found' };
  }
  const rawTitle = h1Line.replace(/^#\s+/, '').trim();

  const episodeNumber = extractEpisodeNumber(rawTitle);
  if (episodeNumber === null) {
    return { ok: false, sourceFile, reason: 'no episode number in H1', rawH1: rawTitle };
  }

  const colonParts = rawTitle.split(COLON);
  const chineseName = colonParts.length > 1 ? colonParts[colonParts.length - 1]!.trim() : '';

  // --- 公案 H2: CS concept (zh + en) ---
  const koanH2Indexes = lines
    .map((l, i) => ({ l, i }))
    .filter(({ l }) => /^##\s+/.test(l) && KOAN_H2.test(l.replace(/^##\s+/, '').trim()));

  if (koanH2Indexes.length === 0) {
    const anyH2 = lines.find((l) => /^##\s+/.test(l));
    return {
      ok: false,
      sourceFile,
      reason: 'no 公案 H2 found',
      rawH1: rawTitle,
      ...(anyH2 ? { rawH2: anyH2.replace(/^##\s+/, '').trim() } : {}),
    };
  }

  const warnings: string[] = [];
  if (koanH2Indexes.length > 1) {
    warnings.push('multiple_koan_h2');
  }

  const { l: h2Line, i: h2Index } = koanH2Indexes[0]!;
  const h2Content = h2Line.replace(/^##\s+/, '').trim();
  const afterKoan = h2Content.replace(KOAN_H2, '').trim();

  const bracketRe = new RegExp(`^(.*?)\\s*[${OPEN_BRACKET}](.+)[${CLOSE_BRACKET}]\\s*$`);
  const bracketMatch = afterKoan.match(bracketRe);

  let csConceptZh: string;
  let csConceptEn: string;
  if (bracketMatch) {
    csConceptZh = bracketMatch[1]!.trim();
    csConceptEn = bracketMatch[2]!.trim();
  } else {
    csConceptZh = afterKoan.trim();
    csConceptEn = '';
    warnings.push('incomplete_metadata');
  }

  const body = lines.slice(h2Index + 1).join('\n').trim();

  return {
    ok: true,
    warnings,
    koan: { episodeNumber, chineseName, csConceptZh, csConceptEn, body, rawTitle, sourceFile },
  };
}
