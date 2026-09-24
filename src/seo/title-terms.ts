// Picks the Chinese and English title terms from a koan's name/concept
// fields, tolerant of authors mixing which field holds which script.
//
// koan.ts extracts chineseName from the H1 (after the colon) and
// csConceptZh/csConceptEn from the H2 `## 公案：X（Y）` (X before the
// bracket, Y inside) without checking which side actually holds Chinese vs.
// English. Real files disagree on convention:
//   ep115 H2 "告警疲劳（Alert Fatigue）"     → csConceptZh=zh, csConceptEn=en (as expected)
//   ep116 H2 "SLO（服务水平目标）"           → csConceptZh='SLO', csConceptEn='服务水平目标' (reversed!)
//   ep140 H1 "Keep-Alive", H2 "Keep-Alive（保活）" → chineseName is English
// Picking by trailing character (CJK vs. not) rather than by field name
// sidesteps the convention entirely.

export interface TitleTermInput {
  chineseName: string;
  csConceptZh: string;
  csConceptEn: string;
}

export interface TitleTerms {
  zh: string;
  en: string;
}

// CJK Unified Ideographs block — sufficient for the koan corpus (Traditional
// + Simplified names); no need for extension blocks or CJK punctuation.
const CJK_CHAR = /[一-鿿]/;

function lastCharIsCJK(s: string): boolean {
  if (!s) return false;
  return CJK_CHAR.test(s[s.length - 1]!);
}

function containsNoCJK(s: string): boolean {
  return !CJK_CHAR.test(s);
}

/**
 * zh: first of [chineseName, csConceptZh, csConceptEn] (trimmed, non-empty)
 * whose LAST character is CJK; '' if none.
 * en: first of [csConceptEn, csConceptZh, chineseName] (trimmed, non-empty)
 * that contains NO CJK characters; '' if none.
 */
export function pickTitleTerms(koan: TitleTermInput): TitleTerms {
  const zhCandidates = [koan.chineseName, koan.csConceptZh, koan.csConceptEn]
    .map((s) => s.trim())
    .filter(Boolean);
  const enCandidates = [koan.csConceptEn, koan.csConceptZh, koan.chineseName]
    .map((s) => s.trim())
    .filter(Boolean);

  return {
    zh: zhCandidates.find(lastCharIsCJK) ?? '',
    en: enCandidates.find(containsNoCJK) ?? '',
  };
}
