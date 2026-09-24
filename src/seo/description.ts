// Locale-aware description rendering (V3). Dispatches to per-locale Nunjucks
// templates (zh_TW Traditional / zh_CN_XHS Simplified) via templates/description.j2.
// The LLM hook paragraph is generated per-locale upstream and passed in here.

import { renderTemplate } from '../llm/prompts/loader';
import type { Locale } from '../core/manifest';
import { pickTitleTerms } from './title-terms';

export interface DescriptionInput {
  locale: Locale;
  koan: { chineseName: string; csConceptZh: string; csConceptEn: string };
  llm_hook_paragraph: string;
  chapters: string;
  hashtags: string[];
}

export function renderDescription(input: DescriptionInput): string {
  // Line 1 uses the same script-agnostic term picker as the title (see
  // src/seo/title-terms.ts) instead of trusting cs_concept_en/chinese_name
  // directly — H1/H2 authors don't agree on which field holds which script.
  const { zh: title_term_zh, en: title_term_en } = pickTitleTerms(input.koan);
  return renderTemplate('templates/description.j2', {
    locale: input.locale,
    chinese_name: input.koan.chineseName,
    cs_concept_zh: input.koan.csConceptZh,
    cs_concept_en: input.koan.csConceptEn,
    title_term_zh,
    title_term_en,
    hook_paragraph: input.llm_hook_paragraph,
    chapters: input.chapters,
    hashtags: input.hashtags,
  });
}
