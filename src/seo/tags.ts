// Tag assembly (Phase 5) — mostly deterministic, LLM only supplements.
// Final tag list = channel core tags + parsed koan concepts + 3-5 LLM
// suggestions, deduped and capped to YouTube's practical limit.

export const CORE_STATIC_TAGS = [
  '極客禪',
  'GeekZen',
  '禪宗',
  '公案',
  '計算機科學',
  '程式設計師',
  '冥想',
  '東方哲學',
  'Zen Programming',
] as const;

const MAX_TAGS = 30;

// Deterministic guard (belt-and-suspenders with the prompt constraint): drop any
// tag carrying a 4-digit year — year-stamped tags age badly and the LLM
// occasionally ignores the prompt. e.g. "Algorithm Optimization 2025".
const YEAR_RE = /\b(?:19|20)\d{2}\b/;

export function buildTags(
  koan: { csConceptZh: string; csConceptEn: string },
  llmSuggested: string[],
): string[] {
  const fromKoan = [koan.csConceptZh, koan.csConceptEn];
  const merged = [...CORE_STATIC_TAGS, ...fromKoan, ...llmSuggested]
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && !YEAR_RE.test(t));
  return [...new Set(merged)].slice(0, MAX_TAGS);
}
