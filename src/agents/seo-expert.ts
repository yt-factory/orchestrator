import type { SEOData, TrendKeyword, RegionalSEOSchema } from '../core/manifest';
import type { BaseLLMProvider } from '../llm/providers';
import type { TrendsHook } from './trends-hook';
import type { ChannelProfile } from '../core/channel-profile';
import { rankTitles } from '../prompts/title-ranker';
import { loadPrompt } from '../llm/prompts/loader';
import { logger } from '../utils/logger';
import { safeJsonParse, safeExtract } from '../utils/json-parse';

// ============================================
// Regional personas (injected into prompts/seo/regional*.system.md as {{ persona }}).
// Commit 8 will inline these into the shared regional system prompt.
// ============================================

const REGIONAL_PERSONAS: Record<string, string> = {
  en: `You are a YouTube SEO specialist. Create titles that:
- Match the channel's voice and style (see below)
- Are concise and intriguing, not clickbait
- Target English-speaking audience
- Naturally incorporate these trending keywords if available: {established_trends}`,

  zh: `你是一名YouTube SEO专家。创建标题需要：
- 严格遵循频道的风格和调性（见下方频道信息）
- 简洁、有品位、不使用营销号套路（禁止使用"震惊""居然""必看""深度解析"等词汇）
- 面向中文观众
- 可自然融入以下热词（如有）：{established_trends}`,

  es: `Eres un especialista en SEO de YouTube. Crea títulos que:
- Coincidan con el estilo del canal (ver abajo)
- Sean concisos e intrigantes, sin clickbait
- MUST incorporate these trending keywords if available: {established_trends}`,

  ja: `あなたはYouTube SEOスペシャリストです。タイトル作成のルール：
- チャンネルのスタイルに合わせる（下記参照）
- 簡潔で興味を引く、クリックベイトではない
- 可能であればトレンドキーワードを自然に組み込む：{established_trends}`,

  de: `Du bist ein YouTube-SEO-Spezialist. Erstelle Titel die:
- Zum Stil des Kanals passen (siehe unten)
- Prägnant und faszinierend sind, kein Clickbait
- MUST incorporate these trending keywords if available: {established_trends}`
};

// ============================================
// 热词覆盖验证
// ============================================

function validateTrendCoverage(
  titles: string[],
  establishedTrends: string[]
): { valid: boolean; missingTrends: string[] } {
  if (establishedTrends.length === 0) {
    return { valid: true, missingTrends: [] };
  }

  const titlesLower = titles.map((t) => t.toLowerCase()).join(' ');
  const missingTrends = establishedTrends.filter(
    (trend) => !titlesLower.includes(trend.toLowerCase())
  );

  return {
    valid: missingTrends.length === 0,
    missingTrends
  };
}

// ============================================
// 内部生成函数
// ============================================

async function extractPrimaryTopic(
  rawContent: string,
  provider: BaseLLMProvider,
  projectId: string
): Promise<string> {
  const { system, user, version } = loadPrompt('seo/topic', {
    content: rawContent.slice(0, 500),
  });

  // tier: fast — short structured topic extraction.
  const result = await provider.complete(system, user, {
    tier: 'fast',
    projectId,
    priority: 'high',
    templateVersion: version,
  });

  const parsed = safeJsonParse<{ topic: string }>(result.text, {
    projectId,
    operation: 'extractPrimaryTopic'
  });
  return parsed.topic ?? 'Unknown Topic';
}

async function generateRegionalTitles(
  provider: BaseLLMProvider,
  projectId: string,
  coreFacts: string[],
  locale: string,
  persona: string
): Promise<string[]> {
  const { system, user, version } = loadPrompt('seo/regional', {
    persona,
    facts: coreFacts.join('\n'),
    locale,
  });

  // tier: smart — regional title copywriting.
  const result = await provider.complete(system, user, {
    tier: 'smart',
    projectId,
    priority: 'medium',
    templateVersion: version,
  });

  const parsed = safeJsonParse<{ titles: string[] }>(result.text, {
    projectId,
    operation: `generateRegionalTitles:${locale}`
  });
  return parsed.titles ?? [];
}

async function forceRegenerateTitlesWithTrends(
  provider: BaseLLMProvider,
  projectId: string,
  coreFacts: string[],
  locale: string,
  persona: string,
  missingTrends: string[]
): Promise<string[]> {
  const { system, user, version } = loadPrompt('seo/regional-trend-force', {
    persona,
    facts: coreFacts.join('\n'),
    missing_trends: missingTrends.join(', '),
  });

  // tier: smart — title copywriting (trend-forced regeneration).
  const result = await provider.complete(system, user, {
    tier: 'smart',
    projectId,
    priority: 'medium',
    templateVersion: version,
  });

  const parsed = safeJsonParse<{ titles: string[] }>(result.text, {
    projectId,
    operation: `forceRegenerateTitlesWithTrends:${locale}`
  });
  return parsed.titles ?? [];
}

async function generateRegionalDescription(
  provider: BaseLLMProvider,
  projectId: string,
  coreFacts: string[],
  locale: string,
  profile: ChannelProfile
): Promise<string> {
  const forbiddenWords = profile.voice.forbidden_words?.length
    ? `\nFORBIDDEN words/phrases (never use these): ${profile.voice.forbidden_words.join(', ')}`
    : '';

  const { system, user, version } = loadPrompt('seo/description', {
    locale,
    facts: coreFacts.join('\n'),
    channel_name: profile.channel_name,
    tone: profile.voice.tone.join(', '),
    demographics: profile.audience.demographics,
    forbidden_words: forbiddenWords,
    tone_slash: profile.voice.tone.join('/'),
  });

  // tier: smart — regional description copywriting.
  const result = await provider.complete(system, user, {
    tier: 'smart',
    projectId,
    priority: 'medium',
    templateVersion: version,
  });

  const parsed = safeJsonParse<{ description: string }>(result.text, {
    projectId,
    operation: `generateRegionalDescription:${locale}`
  });
  return parsed.description ?? '';
}

function extractCulturalHooks(description: string): string[] {
  // 提取前 3 个有文化特色的短语
  const sentences = description.split(/[.!?。！？]/).filter(Boolean);
  return sentences.slice(0, 3).map((s) => s.trim().slice(0, 50));
}

async function generateFAQ(
  provider: BaseLLMProvider,
  projectId: string,
  coreFacts: string[]
): Promise<Array<{ question: string; answer: string; related_entities: string[] }>> {
  const { system, user, version } = loadPrompt('seo/faq', {
    facts: coreFacts.join('\n'),
  });

  // tier: fast — templated FAQ generation.
  const result = await provider.complete(system, user, {
    tier: 'fast',
    projectId,
    priority: 'medium',
    templateVersion: version,
  });

  const parsed = safeJsonParse<{ faq: Array<{ question: string; answer: string; related_entities: string[] }> }>(
    result.text,
    { projectId, operation: 'generateFAQ' }
  );
  return parsed.faq ?? [];
}

async function generateSmartChapters(
  provider: BaseLLMProvider,
  projectId: string,
  rawContent: string,
  establishedTrends: string[]
): Promise<string> {
  const trendLine = establishedTrends.length > 0
    ? `Try to include these trending terms in chapter titles: ${establishedTrends.join(', ')}`
    : '';
  const { system, user, version } = loadPrompt('seo/chapters', {
    trend_line: trendLine,
    content: rawContent.slice(0, 2000),
  });

  // tier: fast — chapter-marker extraction (replaced by pure regex in Phase 5).
  const result = await provider.complete(system, user, {
    tier: 'fast',
    projectId,
    priority: 'medium',
    templateVersion: version,
  });

  const parsed = safeJsonParse<{ chapters: string }>(result.text, {
    projectId,
    operation: 'generateSmartChapters'
  });
  return parsed.chapters ?? '';
}

async function generateTags(
  coreFacts: string[],
  trends: TrendKeyword[],
  provider: BaseLLMProvider,
  projectId: string,
  profile: ChannelProfile
): Promise<string[]> {
  const trendTags = trends.map((t) => t.keyword);

  const forbiddenWords = profile.voice.forbidden_words?.length
    ? `\nFORBIDDEN words (never use in tags): ${profile.voice.forbidden_words.join(', ')}`
    : '';

  const { system, user, version } = loadPrompt('seo/tags', {
    channel_name: profile.channel_name,
    niche: profile.niche,
    demographics: profile.audience.demographics,
    tone: profile.voice.tone.join(', '),
    forbidden_words: forbiddenWords,
    facts: coreFacts.join('\n'),
  });

  // tier: fast — supplementary tag suggestions.
  const result = await provider.complete(system, user, {
    tier: 'fast',
    projectId,
    priority: 'low',
    templateVersion: version,
  });

  const parsed = safeJsonParse<{ tags: string[] }>(result.text, {
    projectId,
    operation: 'generateTags'
  });
  const generatedTags = parsed.tags ?? [];

  // Combine trend keywords + generated tags, dedup, cap at 30
  const combined = [...new Set([...trendTags, ...generatedTags])];
  return combined.slice(0, 30);
}

function detectLanguage(content: string): 'en' | 'zh' {
  const chineseChars = content.match(/[\u4e00-\u9fa5]/g) || [];
  return chineseChars.length / content.length > 0.3 ? 'zh' : 'en';
}

function calculateTrendCoverageScore(
  regionalResults: Array<{ contains_established_trend: boolean }>,
  establishedTrends: string[]
): number {
  if (establishedTrends.length === 0) return 100;

  const coveredCount = regionalResults.filter((r) => r.contains_established_trend).length;
  return Math.round((coveredCount / regionalResults.length) * 100);
}

// ============================================
// SEO 生成主流程
// ============================================

export async function generateMultiLangSEO(
  rawContent: string,
  projectId: string,
  provider: BaseLLMProvider,
  trendsHook: TrendsHook,
  profile: ChannelProfile
): Promise<SEOData> {
  // Step 0: 获取热词 (含 Authority)
  const topic = await extractPrimaryTopic(rawContent, provider, projectId);
  const allTrends = await trendsHook.getHotKeywords(topic, provider, projectId);
  const establishedTrends = allTrends
    .filter((t) => t.authority === 'established')
    .map((t) => t.keyword);

  logger.info('Trends retrieved', {
    projectId,
    total: allTrends.length,
    established: establishedTrends.length
  });

  // Step 1: 提取核心事实
  // tier: fast — structured fact/entity extraction.
  const analyst = loadPrompt('seo/content-analyst', { content: rawContent });
  const analysisResult = await provider.complete(
    analyst.system,
    analyst.user,
    { tier: 'fast', projectId, priority: 'high', templateVersion: analyst.version },
  );
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

  // Step 2: 并行生成各语言版本
  const regionalResults: Array<{
    language: 'en' | 'zh' | 'es' | 'ja' | 'de';
    titles: string[];
    description: string;
    cultural_hooks: string[];
    contains_established_trend: boolean;
  }> = [];

  const primaryLanguage = profile.primary_language ?? 'en';

  for (const [locale, persona] of Object.entries(REGIONAL_PERSONAS)) {
    // Inject channel profile voice/audience context alongside existing persona
    const profileContext = [
      `Channel name: ${profile.channel_name}`,
      `Channel tone: ${profile.voice.tone.join(', ')}`,
      `Title style: ${profile.quality?.title_style ?? 'concise'}`,
      `Target demographics: ${profile.audience.demographics}`,
      `Title format guidance: Titles should feel like they belong to this channel. Use the channel name as prefix if it has a series format (e.g. "ChannelName 01：Topic").`,
    ].join('\n');

    const personalizedPersona = [
      persona.replace(
        '{established_trends}',
        establishedTrends.join(', ') || 'none available'
      ),
      profileContext,
    ].join('\n');

    let titles = await generateRegionalTitles(
      provider,
      projectId,
      core_facts,
      locale,
      personalizedPersona
    );

    // 验证热词覆盖
    const validation = validateTrendCoverage(titles, establishedTrends);

    if (!validation.valid && establishedTrends.length > 0) {
      logger.warn('Titles missing established trends, regenerating', {
        projectId,
        locale,
        missingTrends: validation.missingTrends
      });

      titles = await forceRegenerateTitlesWithTrends(
        provider,
        projectId,
        core_facts,
        locale,
        personalizedPersona,
        validation.missingTrends
      );
    }

    // Rank titles by CTR potential for the primary language only
    if (locale === primaryLanguage && titles.length > 0) {
      titles = await rankTitles(titles, profile, core_facts, provider, projectId);
      const bestTitle = titles[0];
      if (bestTitle !== undefined) {
        logger.info('Best ranked title for primary language', {
          projectId,
          locale,
          bestTitle,
        });
      }
    }

    const description = await generateRegionalDescription(
      provider,
      projectId,
      core_facts,
      locale,
      profile
    );

    regionalResults.push({
      language: locale as 'en' | 'zh' | 'es' | 'ja' | 'de',
      titles,
      description,
      cultural_hooks: extractCulturalHooks(description),
      contains_established_trend: validateTrendCoverage(titles, establishedTrends).valid
    });
  }

  // Step 3: 生成 FAQ
  const faq = await generateFAQ(provider, projectId, core_facts);

  // Step 4: 生成章节
  const chapters = await generateSmartChapters(
    provider,
    projectId,
    rawContent,
    establishedTrends
  );

  // 计算热词覆盖率
  const trendCoverageScore = calculateTrendCoverageScore(regionalResults, establishedTrends);

  return {
    primary_language: detectLanguage(rawContent),
    tags: await generateTags(core_facts, allTrends, provider, projectId, profile),
    chapters,
    regional_seo: regionalResults,
    faq_structured_data: faq,
    entities: key_entities,
    injected_trends: allTrends.slice(0, 5),
    trend_coverage_score: trendCoverageScore
  };
}
