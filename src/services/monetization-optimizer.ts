import { MonetizationInfo } from '../core/manifest';
import { GeminiClient } from '../agents/gemini-client';
import { logger } from '../utils/logger';

// Configuration thresholds
const MIN_SCORE_TO_PROCEED = 60;
const TARGET_SCORE = 80;
const MAX_OPTIMIZATION_ATTEMPTS = 3;

// Ad-friendly risk categories
const RISK_DIMENSIONS = [
  'violence_gore',
  'adult_content',
  'controversial_topics',
  'harmful_misinformation',
  'profanity_language'
] as const;

// Risk keywords that may trigger demonetization
const RISK_KEYWORDS: Record<string, string[]> = {
  violence_gore: [
    'kill', 'death', 'murder', 'blood', 'violent', 'attack',
    'weapon', 'gun', 'knife', 'fight', 'war', 'massacre'
  ],
  adult_content: [
    'explicit', 'sexual', 'nude', 'porn', 'xxx', 'erotic',
    'mature', 'nsfw'
  ],
  controversial_topics: [
    'political', 'election', 'conspiracy', 'extremist',
    'hate', 'discrimination', 'racist'
  ],
  harmful_misinformation: [
    'cure', 'miracle', 'guaranteed', 'doctor hates',
    'they don\'t want you to know', 'banned', 'suppressed'
  ],
  profanity_language: [
    // Keeping this mild for the codebase
    'damn', 'hell', 'crap'
  ]
};

// Brand-safe replacement phrases
const SAFE_REPLACEMENTS: Record<string, string> = {
  'kill': 'defeat',
  'death': 'ending',
  'attack': 'approach',
  'fight': 'competition',
  'war': 'conflict',
  'guaranteed': 'likely',
  'miracle': 'effective',
  'hate': 'dislike'
};

// Regional ad restrictions
const REGIONAL_RESTRICTIONS: Record<string, string[]> = {
  'en-US': [], // Generally permissive
  'de-DE': ['gambling', 'alcohol'],
  'ja-JP': ['gambling', 'tobacco'],
  'zh-CN': ['politics', 'gambling', 'religion']
};

/**
 * Pre-scores content for ad suitability before resource-intensive generation
 */
export class MonetizationOptimizer {
  constructor(private geminiClient: GeminiClient) {}

  /**
   * Pre-score content before generation
   */
  async preScoreContent(
    projectId: string,
    topic: string,
    outline: string,
    targetRegions: string[] = ['en-US']
  ): Promise<{
    score: number;
    level: 'safe' | 'moderate' | 'risky' | 'blocked';
    risks: Array<{ dimension: string; severity: number; details: string }>;
    blockedRegions: string[];
    safeRegions: string[];
  }> {
    logger.info('Pre-scoring content for ad suitability', {
      projectId,
      topic
    });

    // Step 1: Quick keyword scan
    const keywordRisks = this.scanForRiskKeywords(topic + ' ' + outline);

    // Step 2: AI-powered content analysis
    const aiAnalysis = await this.aiContentAnalysis(
      projectId,
      topic,
      outline
    );

    // Step 3: Regional restriction check
    const { blockedRegions, safeRegions } = this.checkRegionalRestrictions(
      targetRegions,
      aiAnalysis.topics
    );

    // Step 4: Calculate final score
    const score = this.calculateScore(keywordRisks, aiAnalysis);
    const level = this.scoreToLevel(score);

    const result = {
      score,
      level,
      risks: [
        ...keywordRisks.map((k) => ({
          dimension: k.dimension,
          severity: k.severity,
          details: `Found risk keywords: ${k.keywords.join(', ')}`
        })),
        ...aiAnalysis.risks
      ],
      blockedRegions,
      safeRegions
    };

    logger.info('Content pre-scored', {
      projectId,
      score,
      level,
      riskCount: result.risks.length
    });

    return result;
  }

  /**
   * Optimize content for ad-friendliness
   */
  async optimizeForAds(
    projectId: string,
    originalOutline: string,
    preScoreResult: Awaited<ReturnType<MonetizationOptimizer['preScoreContent']>>
  ): Promise<{
    optimizedOutline: string;
    newScore: number;
    changesApplied: string[];
  }> {
    if (preScoreResult.score >= TARGET_SCORE) {
      return {
        optimizedOutline: originalOutline,
        newScore: preScoreResult.score,
        changesApplied: []
      };
    }

    logger.info('Optimizing content for ads', {
      projectId,
      currentScore: preScoreResult.score,
      targetScore: TARGET_SCORE
    });

    let currentOutline = originalOutline;
    let currentScore = preScoreResult.score;
    const changesApplied: string[] = [];
    let attempts = 0;

    while (currentScore < TARGET_SCORE && attempts < MAX_OPTIMIZATION_ATTEMPTS) {
      attempts++;

      // Step 1: Apply keyword replacements
      const { text: keywordReplaced, changes: keywordChanges } =
        this.applyKeywordReplacements(currentOutline);
      changesApplied.push(...keywordChanges);

      // Step 2: AI-powered reframing
      const reframedOutline = await this.aiReframeContent(
        projectId,
        keywordReplaced,
        preScoreResult.risks
      );
      currentOutline = reframedOutline;

      // Step 3: Re-score
      const newScoreResult = await this.preScoreContent(
        projectId,
        '', // Empty topic since we're re-scoring outline
        currentOutline
      );
      currentScore = newScoreResult.score;

      logger.debug('Optimization attempt complete', {
        projectId,
        attempt: attempts,
        newScore: currentScore
      });
    }

    return {
      optimizedOutline: currentOutline,
      newScore: currentScore,
      changesApplied
    };
  }

  /**
   * Check if content should proceed to generation
   */
  shouldProceed(
    score: number,
    level: string
  ): { proceed: boolean; reason: string } {
    if (score >= TARGET_SCORE) {
      return { proceed: true, reason: 'Content is ad-friendly' };
    }

    if (score >= MIN_SCORE_TO_PROCEED) {
      return {
        proceed: true,
        reason: `Content may have limited monetization (score: ${score})`
      };
    }

    return {
      proceed: false,
      reason: `Content score (${score}) below minimum threshold (${MIN_SCORE_TO_PROCEED})`
    };
  }

  /**
   * Create monetization info for manifest
   */
  createMonetizationInfo(
    preScoreResult: Awaited<ReturnType<MonetizationOptimizer['preScoreContent']>>,
    optimizationApplied: boolean
  ): MonetizationInfo {
    const cpmRange = this.estimateCpmRange(preScoreResult.score);

    return {
      ad_suitability_score: preScoreResult.score,
      ad_suitability_level: preScoreResult.level,
      estimated_cpm_range: cpmRange,
      safe_regions: preScoreResult.safeRegions,
      blocked_regions: preScoreResult.blockedRegions,
      optimization_applied: optimizationApplied
    };
  }

  /**
   * Scan for risk keywords
   */
  private scanForRiskKeywords(
    text: string
  ): Array<{ dimension: string; keywords: string[]; severity: number }> {
    const lowerText = text.toLowerCase();
    const results: Array<{
      dimension: string;
      keywords: string[];
      severity: number;
    }> = [];

    for (const [dimension, keywords] of Object.entries(RISK_KEYWORDS)) {
      const foundKeywords: string[] = [];

      for (const keyword of keywords) {
        if (lowerText.includes(keyword)) {
          foundKeywords.push(keyword);
        }
      }

      if (foundKeywords.length > 0) {
        results.push({
          dimension,
          keywords: foundKeywords,
          severity: Math.min(10, foundKeywords.length * 2)
        });
      }
    }

    return results;
  }

  /**
   * AI-powered content analysis
   */
  private async aiContentAnalysis(
    projectId: string,
    topic: string,
    outline: string
  ): Promise<{
    topics: string[];
    risks: Array<{ dimension: string; severity: number; details: string }>;
    overallRisk: number;
  }> {
    const prompt = `
Analyze this content for YouTube advertiser-friendliness.

TOPIC: ${topic}

OUTLINE:
${outline.slice(0, 2000)}

Analyze across these dimensions:
1. violence_gore (violence, graphic content)
2. adult_content (sexual/mature themes)
3. controversial_topics (political, divisive issues)
4. harmful_misinformation (health claims, conspiracy)
5. profanity_language (swearing, crude language)

Output as JSON:
{
  "topics": ["main topic1", "topic2"],
  "risks": [
    {
      "dimension": "dimension_name",
      "severity": 0-10,
      "details": "specific concern"
    }
  ],
  "overall_risk": 0-10
}

If content appears safe, return empty risks array with overall_risk: 0.
`;

    try {
      const result = await this.geminiClient.generate(prompt, {
        projectId,
        priority: 'medium'
      });

      return JSON.parse(result.text);
    } catch (error) {
      logger.warn('AI content analysis failed', {
        projectId,
        error: (error as Error).message
      });
      // Conservative fallback
      return { topics: [], risks: [], overallRisk: 3 };
    }
  }

  /**
   * Check regional restrictions
   */
  private checkRegionalRestrictions(
    targetRegions: string[],
    topics: string[]
  ): { blockedRegions: string[]; safeRegions: string[] } {
    const blockedRegions: string[] = [];
    const safeRegions: string[] = [];

    for (const region of targetRegions) {
      const restrictions = REGIONAL_RESTRICTIONS[region] || [];
      const isBlocked = topics.some((topic) =>
        restrictions.some((r) => topic.toLowerCase().includes(r))
      );

      if (isBlocked) {
        blockedRegions.push(region);
      } else {
        safeRegions.push(region);
      }
    }

    return { blockedRegions, safeRegions };
  }

  /**
   * Calculate final ad suitability score
   */
  private calculateScore(
    keywordRisks: Array<{ severity: number }>,
    aiAnalysis: { overallRisk: number }
  ): number {
    // Start with perfect score
    let score = 100;

    // Deduct for keyword risks
    for (const risk of keywordRisks) {
      score -= risk.severity * 3;
    }

    // Deduct for AI-identified risks
    score -= aiAnalysis.overallRisk * 5;

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Convert score to level
   */
  private scoreToLevel(
    score: number
  ): 'safe' | 'moderate' | 'risky' | 'blocked' {
    if (score >= 80) return 'safe';
    if (score >= 60) return 'moderate';
    if (score >= 40) return 'risky';
    return 'blocked';
  }

  /**
   * Apply safe keyword replacements
   */
  private applyKeywordReplacements(
    text: string
  ): { text: string; changes: string[] } {
    let result = text;
    const changes: string[] = [];

    for (const [risky, safe] of Object.entries(SAFE_REPLACEMENTS)) {
      const regex = new RegExp(`\\b${risky}\\b`, 'gi');
      if (regex.test(result)) {
        result = result.replace(regex, safe);
        changes.push(`Replaced "${risky}" with "${safe}"`);
      }
    }

    return { text: result, changes };
  }

  /**
   * AI-powered content reframing
   */
  private async aiReframeContent(
    projectId: string,
    outline: string,
    risks: Array<{ dimension: string; details: string }>
  ): Promise<string> {
    const riskSummary = risks
      .map((r) => `- ${r.dimension}: ${r.details}`)
      .join('\n');

    const prompt = `
Reframe this content outline to be more advertiser-friendly while preserving the educational value.

ORIGINAL OUTLINE:
${outline}

IDENTIFIED RISKS:
${riskSummary || 'None identified, but improve ad-friendliness'}

REFRAME GUIDELINES:
1. Replace controversial angles with neutral alternatives
2. Use brand-safe language
3. Focus on educational/informative framing
4. Avoid sensationalism
5. Keep the core message intact

Output ONLY the reframed outline, nothing else.
`;

    try {
      const result = await this.geminiClient.generate(prompt, {
        projectId,
        priority: 'medium'
      });

      return result.text.trim();
    } catch (error) {
      logger.warn('AI reframing failed, returning original', {
        projectId,
        error: (error as Error).message
      });
      return outline;
    }
  }

  /**
   * Estimate CPM range based on score
   */
  private estimateCpmRange(score: number): [number, number] {
    if (score >= 80) return [8, 15];
    if (score >= 60) return [4, 8];
    if (score >= 40) return [1, 4];
    return [0, 1];
  }
}
