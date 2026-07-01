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

// Ones-place characters, incl. 零 placeholder, 两 variants, and financial forms.
const CN_DIGITS: Record<string, number> = {
  零: 0, '〇': 0, '○': 0,
  一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
  两: 2, 兩: 2,
  壹: 1, 貳: 2, 參: 3, 肆: 4, 伍: 5, 陸: 6, 柒: 7, 捌: 8, 玖: 9,
};

// Multiplier units, incl. financial forms (拾/佰/仟).
const CN_UNITS: Record<string, number> = {
  十: 10, 拾: 10,
  百: 100, 佰: 100,
  千: 1000, 仟: 1000,
};

/**
 * Convert a Chinese numeral string to an integer (1-9999 range).
 *
 * Handles the 零 placeholder pattern (一百零一 = 101, 一千零八十 = 1080),
 * bare units (十 = 10, 一百 = 100), and financial characters (壹佰零壹 = 101).
 *
 * Returns `null` — never a silent 0 — for empty, malformed, or
 * unknown-character input. A bare 零 or stray character must NOT masquerade
 * as a valid number: silent-wrong is worse than a loud reject.
 */
export function parseChineseNumber(input: string): number | null {
  if (!input) return null;
  if (/^\d+$/.test(input)) return parseInt(input, 10); // arabic passthrough

  let total = 0;
  let section = 0;
  let sawNumeral = false;
  for (const ch of input) {
    const digit = CN_DIGITS[ch];
    if (digit !== undefined) {
      section = digit;
      sawNumeral = true;
      continue;
    }
    const unit = CN_UNITS[ch];
    if (unit === undefined) return null; // unknown character → reject, not skip
    // Bare/leading unit (十一 = 11, 一百 vs 百): treat a zero section as 1 * unit.
    section = (section === 0 ? 1 : section) * unit;
    total += section;
    section = 0;
    sawNumeral = true;
  }

  const result = total + section;
  return sawNumeral && result > 0 ? result : null;
}

// Numeral character class kept in lockstep with the DIGITS/UNITS tables so the
// extraction regex can never drift out of sync with what the converter knows.
// (The original ep101 blocker was exactly this drift: 零 was in neither, and the
// regex class silently truncated 「一百零一」 before parseChineseNumber ran.)
const CN_NUMERAL_CLASS = [...Object.keys(CN_DIGITS), ...Object.keys(CN_UNITS)].join('');
const CHINESE_EPISODE_RE = new RegExp(`第\\s*([${CN_NUMERAL_CLASS}]+)\\s*[则則]`);

const COLON = /[：:︰]/; // fullwidth, ASCII, CJK presentation-form
const OPEN_BRACKET = '（(［〔';
const CLOSE_BRACKET = '）)］〕';
const KOAN_H2 = new RegExp(`^公案${COLON.source}`);

export function extractEpisodeNumber(h1: string): number | null {
  const arabic = h1.match(/第\s*(\d+)\s*[则則]/);
  if (arabic) return parseInt(arabic[1]!, 10);
  const chinese = h1.match(CHINESE_EPISODE_RE);
  if (chinese) {
    const n = parseChineseNumber(chinese[1]!);
    if (n !== null) return n; // fall through to latin form if numerals are unparseable
  }
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
