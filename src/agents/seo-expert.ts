import { SUPPORTED_LOCALES, type SEOData, type Locale } from '../core/manifest';
import type { BaseLLMProvider } from '../llm/providers';
import type { TrendsHook } from './trends-hook';
import type { ChannelProfile } from '../core/channel-profile';
import type { ParsedKoan } from '../parsers/koan';
import { loadPrompt } from '../llm/prompts/loader';
import { renderDescription } from '../seo/description';
import { extractChapters } from '../seo/chapters';
import { buildTags, CORE_STATIC_TAGS } from '../seo/tags';
import { logger } from '../utils/logger';
import { safeJsonParse } from '../utils/json-parse';

// Phase 5: SEO is template-driven. The LLM is used only for "点睛" touches —
// a per-locale title hook, one description hook paragraph, and a few
// supplementary tags. Structure (title format, description frame, core tags,
// chapters) is deterministic. Titles/descriptions are no longer fully
// LLM-generated, and title-ranker / force-regenerate are dropped from this path.
//
// Locales are SUPPORTED_LOCALES (zh_TW, zh_CN_XHS) from the manifest schema.

function validateTrendCoverage(
  titles: string[],
  establishedTrends: string[],
): { valid: boolean; missingTrends: string[] } {
  if (establishedTrends.length === 0) {
    return { valid: true, missingTrends: [] };
  }
  const titlesLower = titles.map((t) => t.toLowerCase()).join(' ');
  const missingTrends = establishedTrends.filter(
    (trend) => !titlesLower.includes(trend.toLowerCase()),
  );
  return { valid: missingTrends.length === 0, missingTrends };
}

async function extractPrimaryTopic(
  rawContent: string,
  provider: BaseLLMProvider,
  projectId: string,
): Promise<string> {
  const { system, user, version } = loadPrompt('seo/topic', { content: rawContent.slice(0, 500) });
  const result = await provider.complete(system, user, {
    tier: 'fast',
    projectId,
    priority: 'high',
    templateVersion: version,
  });
  const parsed = safeJsonParse<{ topic: string }>(result.text, { projectId, operation: 'extractPrimaryTopic' });
  return parsed.topic ?? 'Unknown Topic';
}

async function generateFAQ(
  provider: BaseLLMProvider,
  projectId: string,
  coreFacts: string[],
  locale: Locale,
): Promise<Array<{ question: string; answer: string; related_entities: string[] }>> {
  const { system, user, version } = loadPrompt('seo/faq', { facts: coreFacts.join('\n'), locale });
  const result = await provider.complete(system, user, {
    tier: 'fast',
    projectId,
    priority: 'medium',
    templateVersion: version,
  });
  const parsed = safeJsonParse<{ faq: Array<{ question: string; answer: string; related_entities: string[] }> }>(
    result.text,
    { projectId, operation: `generateFAQ:${locale}` },
  );
  return parsed.faq ?? [];
}

function detectLanguage(content: string): 'en' | 'zh' {
  const chineseChars = content.match(/[一-龥]/g) || [];
  return chineseChars.length / content.length > 0.3 ? 'zh' : 'en';
}

function calculateTrendCoverageScore(
  regionalResults: Array<{ contains_established_trend: boolean }>,
  establishedTrends: string[],
): number {
  if (establishedTrends.length === 0) return 100;
  const coveredCount = regionalResults.filter((r) => r.contains_established_trend).length;
  return Math.round((coveredCount / regionalResults.length) * 100);
}

// ============================================
// SEO 生成主流程 (template-driven, parsed-koan aware)
// ============================================

export async function generateMultiLangSEO(
  rawContent: string,
  projectId: string,
  provider: BaseLLMProvider,
  trendsHook: TrendsHook,
  profile: ChannelProfile,
  koan: ParsedKoan,
): Promise<SEOData> {
  // Step 0: topic + trends
  const topic = await extractPrimaryTopic(rawContent, provider, projectId);
  const allTrends = await trendsHook.getHotKeywords(topic, provider, projectId);
  const establishedTrends = allTrends
    .filter((t) => t.authority === 'established')
    .map((t) => t.keyword);
  logger.info('Trends retrieved', {
    projectId,
    total: allTrends.length,
    established: establishedTrends.length,
  });

  // Step 1: core facts + entities (fast)
  const analyst = loadPrompt('seo/content-analyst', { content: rawContent });
  const analysisResult = await provider.complete(analyst.system, analyst.user, {
    tier: 'fast',
    projectId,
    priority: 'high',
    templateVersion: analyst.version,
  });
  const analysisData = safeJsonParse<{
    core_facts: string[];
    key_entities: Array<{
      name: string;
      type: 'tool' | 'concept' | 'person' | 'company' | 'technology';
      description?: string;
    }>;
  }>(analysisResult.text, { projectId, operation: 'contentAnalysis' });
  const core_facts = analysisData.core_facts ?? [];
  const key_entities = analysisData.key_entities ?? [];
  const factsText = core_facts.join('\n');

  // Step 3: chapters — regex only, never invented
  const chapters = extractChapters(rawContent);
  if (!chapters) {
    logger.warn(
      `chapters extraction yielded empty result for ${koan.sourceFile} — koan body has no [MM:SS] markers (expected: real timestamps come post-audio)`,
      { projectId },
    );
  }

  // Step 4: tags — static core + koan concepts + trend keywords + LLM supplements
  const existingTags = [...CORE_STATIC_TAGS, koan.csConceptZh, koan.csConceptEn, ...allTrends.map((t) => t.keyword)]
    .filter(Boolean)
    .join(', ');
  const tagPrompt = loadPrompt('seo/tag-suggest', {
    chinese_name: koan.chineseName,
    cs_concept_en: koan.csConceptEn,
    existing_tags: existingTags,
    facts: factsText,
  });
  const tagRes = await provider.complete(tagPrompt.system, tagPrompt.user, {
    tier: 'fast',
    projectId,
    priority: 'low',
    templateVersion: tagPrompt.version,
  });
  const llmTags = safeJsonParse<{ tags: string[] }>(tagRes.text, { projectId, operation: 'tagSuggest' }).tags ?? [];
  const tags = buildTags(koan, [...allTrends.map((t) => t.keyword), ...llmTags]);

  const hashtags = ['极客禅', 'GeekZen', '禅宗', '公案', koan.csConceptEn.replace(/\s+/g, '')].filter(Boolean);

  // Step 5: per-locale title (LLM hook + template concat) + templated description
  const regionalResults: Array<{
    language: Locale;
    titles: string[];
    description: string;
    faq: Array<{ question: string; answer: string; related_entities: string[] }>;
    contains_established_trend: boolean;
  }> = [];

  for (const locale of SUPPORTED_LOCALES) {
    const hookPrompt = loadPrompt('seo/title-hook', {
      locale,
      channel_name: profile.channel_name,
      tagline: profile.tagline,
      chinese_name: koan.chineseName,
      cs_concept_en: koan.csConceptEn,
      facts: factsText,
    });
    const hookRes = await provider.complete(hookPrompt.system, hookPrompt.user, {
      tier: 'fast',
      projectId,
      priority: 'medium',
      templateVersion: hookPrompt.version,
    });
    const hook = (
      safeJsonParse<{ hook: string }>(hookRes.text, { projectId, operation: `titleHook:${locale}` }).hook ?? ''
    ).trim();
    const title = `${hook} | ${koan.chineseName} | ${koan.csConceptEn}`;

    // Per-locale description hook (zh_TW Traditional vs zh_CN_XHS Simplified),
    // generated per locale — not shared (fix for the commit-10 reuse bug).
    const descHook = loadPrompt('seo/description-hook', {
      locale,
      chinese_name: koan.chineseName,
      cs_concept_en: koan.csConceptEn,
      facts: factsText,
    });
    const descHookRes = await provider.complete(descHook.system, descHook.user, {
      tier: 'fast',
      projectId,
      priority: 'medium',
      templateVersion: descHook.version,
    });
    const hookParagraph = safeJsonParse<{ hook_paragraph: string }>(
      descHookRes.text,
      { projectId, operation: `descriptionHook:${locale}` },
    ).hook_paragraph ?? '';

    const description = renderDescription({
      locale,
      koan,
      llm_hook_paragraph: hookParagraph,
      chapters,
      hashtags,
    });

    // Per-locale FAQ — Chinese in the locale's script (was top-level English).
    const faq = await generateFAQ(provider, projectId, core_facts, locale);

    regionalResults.push({
      language: locale,
      titles: [title],
      description,
      faq,
      contains_established_trend: validateTrendCoverage([title], establishedTrends).valid,
    });
  }

  const trendCoverageScore = calculateTrendCoverageScore(regionalResults, establishedTrends);

  return {
    primary_language: detectLanguage(rawContent),
    tags,
    chapters,
    regional_seo: regionalResults,
    entities: key_entities,
    injected_trends: allTrends.slice(0, 5),
    trend_coverage_score: trendCoverageScore,
  };
}
