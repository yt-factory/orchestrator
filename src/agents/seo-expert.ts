import type { SEOData, TrendKeyword, RegionalSEOSchema } from '../core/manifest';
import type { GeminiClient } from './gemini-client';
import type { TrendsHook } from './trends-hook';
import { logger } from '../utils/logger';
import { safeJsonParse, safeExtract } from '../utils/json-parse';

// ============================================
// 双角色 Prompt
// ============================================

const CONTENT_ANALYST_PROMPT = `You are a senior content analyst. Extract the following from the given content:

1. core_facts: Array of 5-10 key factual statements
2. key_entities: Array of entities (each with name, type, description)
   - type must be one of: tool, concept, person, company, technology

Output as JSON:
{
  "core_facts": string[],
  "key_entities": [{ "name": string, "type": string, "description": string }]
}`;

const REGIONAL_PERSONAS: Record<string, string> = {
  en: `You are a US YouTube SEO specialist. Create titles that:
- Use power words (Ultimate, Secret, Nobody Tells You)
- Include numbers when possible
- Target English-speaking audience
- MUST naturally incorporate these established trending keywords if available: {established_trends}`,

  zh: `你是一名中国YouTube/B站SEO专家。创建标题需要：
- 使用吸引眼球的词汇（震惊、居然、必看、深度解析）
- 适当使用数字
- 面向中文观众
- 必须自然融入以下热词（如有）：{established_trends}`,

  es: `Eres un especialista en SEO de YouTube para el mercado hispanohablante. Crea títulos que:
- Usen palabras de impacto
- Incluyan números cuando sea posible
- MUST incorporate these trending keywords if available: {established_trends}`,

  ja: `あなたは日本のYouTube SEOスペシャリストです。タイトル作成のルール：
- インパクトのある言葉を使用
- 数字を含める
- 日本語話者向け
- 可能であればトレンドキーワードを自然に組み込む：{established_trends}`,

  de: `Du bist ein YouTube-SEO-Spezialist für den deutschsprachigen Markt. Erstelle Titel die:
- Kraftvolle Wörter verwenden
- Zahlen einbeziehen
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
  geminiClient: GeminiClient,
  projectId: string
): Promise<string> {
  const prompt = `Extract the primary topic of this content in 2-5 words. Output as JSON: { "topic": string }

Content (first 500 chars):
${rawContent.slice(0, 500)}`;

  const result = await geminiClient.generate(prompt, {
    projectId,
    priority: 'high'
  });

  const parsed = safeJsonParse<{ topic: string }>(result.text, {
    projectId,
    operation: 'extractPrimaryTopic'
  });
  return parsed.topic ?? 'Unknown Topic';
}

async function generateRegionalTitles(
  geminiClient: GeminiClient,
  projectId: string,
  coreFacts: string[],
  locale: string,
  persona: string
): Promise<string[]> {
  const prompt = `${persona}

Based on these facts:
${coreFacts.join('\n')}

Generate exactly 5 high-CTR YouTube titles for the ${locale} market.
Output as JSON: { "titles": string[] }`;

  const result = await geminiClient.generate(prompt, {
    projectId,
    priority: 'medium'
  });

  const parsed = safeJsonParse<{ titles: string[] }>(result.text, {
    projectId,
    operation: `generateRegionalTitles:${locale}`
  });
  return parsed.titles ?? [];
}

async function forceRegenerateTitlesWithTrends(
  geminiClient: GeminiClient,
  projectId: string,
  coreFacts: string[],
  locale: string,
  persona: string,
  missingTrends: string[]
): Promise<string[]> {
  const forcePrompt = `${persona}

You MUST include at least ONE of these trending keywords in your titles: ${missingTrends.join(', ')}

Based on these facts:
${coreFacts.join('\n')}

Generate 5 high-CTR titles that naturally incorporate the trending keywords.
Output as JSON: { "titles": string[] }`;

  const result = await geminiClient.generate(forcePrompt, {
    projectId,
    priority: 'medium'
  });

  const parsed = safeJsonParse<{ titles: string[] }>(result.text, {
    projectId,
    operation: `forceRegenerateTitlesWithTrends:${locale}`
  });
  return parsed.titles ?? [];
}

async function generateRegionalDescription(
  geminiClient: GeminiClient,
  projectId: string,
  coreFacts: string[],
  locale: string
): Promise<string> {
  const prompt = `Write a YouTube video description (max 5000 chars) for the ${locale} market based on these facts:
${coreFacts.join('\n')}

Include:
- Hook in first 2 lines
- Key points with timestamps placeholder
- Relevant hashtags
- Call to action

Output as JSON: { "description": string }`;

  const result = await geminiClient.generate(prompt, {
    projectId,
    priority: 'medium'
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
  geminiClient: GeminiClient,
  projectId: string,
  coreFacts: string[]
): Promise<Array<{ question: string; answer: string; related_entities: string[] }>> {
  const prompt = `Based on these facts, generate up to 5 FAQ items for YouTube structured data:
${coreFacts.join('\n')}

Each FAQ must have:
- question: A natural question viewers would ask
- answer: Concise answer (max 200 chars)
- related_entities: Up to 3 entity names mentioned

Output as JSON: { "faq": [{ "question": string, "answer": string, "related_entities": string[] }] }`;

  const result = await geminiClient.generate(prompt, {
    projectId,
    priority: 'medium'
  });

  const parsed = safeJsonParse<{ faq: Array<{ question: string; answer: string; related_entities: string[] }> }>(
    result.text,
    { projectId, operation: 'generateFAQ' }
  );
  return parsed.faq ?? [];
}

async function generateSmartChapters(
  geminiClient: GeminiClient,
  projectId: string,
  rawContent: string,
  establishedTrends: string[]
): Promise<string> {
  const prompt = `Generate YouTube chapter markers for this content. Each chapter should be on a new line in format "MM:SS Chapter Title".
${establishedTrends.length > 0 ? `Try to include these trending terms in chapter titles: ${establishedTrends.join(', ')}` : ''}

Content (first 2000 chars):
${rawContent.slice(0, 2000)}

Output as JSON: { "chapters": string }`;

  const result = await geminiClient.generate(prompt, {
    projectId,
    priority: 'medium'
  });

  const parsed = safeJsonParse<{ chapters: string }>(result.text, {
    projectId,
    operation: 'generateSmartChapters'
  });
  return parsed.chapters ?? '';
}

function extractTags(coreFacts: string[], trends: TrendKeyword[]): string[] {
  const trendTags = trends.map((t) => t.keyword);
  // 从 core facts 提取关键词作为补充 tags
  const factWords = coreFacts
    .join(' ')
    .split(/\s+/)
    .filter((w) => w.length > 4)
    .slice(0, 20);

  const combined = [...new Set([...trendTags, ...factWords])];
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
  geminiClient: GeminiClient,
  trendsHook: TrendsHook
): Promise<SEOData> {
  // Step 0: 获取热词 (含 Authority)
  const topic = await extractPrimaryTopic(rawContent, geminiClient, projectId);
  const allTrends = await trendsHook.getHotKeywords(topic, geminiClient, projectId);
  const establishedTrends = allTrends
    .filter((t) => t.authority === 'established')
    .map((t) => t.keyword);

  logger.info('Trends retrieved', {
    projectId,
    total: allTrends.length,
    established: establishedTrends.length
  });

  // Step 1: 提取核心事实
  const analysisResult = await geminiClient.generate(
    CONTENT_ANALYST_PROMPT + '\n\nContent:\n' + rawContent,
    { projectId, priority: 'high' }
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

  for (const [locale, persona] of Object.entries(REGIONAL_PERSONAS)) {
    const personalizedPersona = persona.replace(
      '{established_trends}',
      establishedTrends.join(', ') || 'none available'
    );

    let titles = await generateRegionalTitles(
      geminiClient,
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
        geminiClient,
        projectId,
        core_facts,
        locale,
        personalizedPersona,
        validation.missingTrends
      );
    }

    const description = await generateRegionalDescription(
      geminiClient,
      projectId,
      core_facts,
      locale
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
  const faq = await generateFAQ(geminiClient, projectId, core_facts);

  // Step 4: 生成章节
  const chapters = await generateSmartChapters(
    geminiClient,
    projectId,
    rawContent,
    establishedTrends
  );

  // 计算热词覆盖率
  const trendCoverageScore = calculateTrendCoverageScore(regionalResults, establishedTrends);

  return {
    primary_language: detectLanguage(rawContent),
    tags: extractTags(core_facts, allTrends),
    chapters,
    regional_seo: regionalResults,
    faq_structured_data: faq,
    entities: key_entities,
    injected_trends: allTrends.slice(0, 5),
    trend_coverage_score: trendCoverageScore
  };
}
