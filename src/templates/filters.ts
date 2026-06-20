// opencc Chinese-variant converters (single source of truth).
//
// opencc does VOCABULARY substitution, not just character mapping, in the
// tw<->cn directions: e.g. 程式設計師 (TW) <-> 程序员 (CN), which is what we want
// for body text and tags matching each platform's conventions.

import * as OpenCC from 'opencc-js';

const s2twConverter = OpenCC.Converter({ from: 'cn', to: 'tw' });
const tw2sConverter = OpenCC.Converter({ from: 'tw', to: 'cn' });

/** Simplified -> Traditional (Taiwan variant). */
export const s2tw = (text: string): string => s2twConverter(String(text ?? ''));

/** Traditional (Taiwan) -> Simplified (mainland). */
export const tw2s = (text: string): string => tw2sConverter(String(text ?? ''));

export type TagLocale = 'zh_TW' | 'zh_CN_XHS';

// Per-term overrides — ONLY where opencc's default is wrong for the tag context
// (empirically verified). opencc-js tw->cn does character-only conversion for
// 程式設計師 -> 程式设计师 (Simplified chars but Taiwan vocabulary), which is
// idiomatic for neither audience; mainland XHS searches 程序员.
const TAG_OVERRIDES: Partial<Record<TagLocale, Record<string, string>>> = {
  zh_CN_XHS: {
    程式設計師: '程序员',
  },
};

/** Render a tag list in the script/vocabulary of the target locale. English /
 *  brand terms (GeekZen, Zen Programming) pass through opencc unchanged. */
export function renderTagsForLocale(tags: string[], locale: TagLocale): string[] {
  const convert = locale === 'zh_TW' ? s2tw : tw2s;
  const overrides = TAG_OVERRIDES[locale] ?? {};
  return tags.map((t) => overrides[t] ?? convert(t));
}
