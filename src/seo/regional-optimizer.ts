import { RegionalSEOSchema, SEOData } from '../core/manifest';
import { GeminiClient } from '../agents/gemini-client';
import { logger } from '../utils/logger';
import { z } from 'zod';

// Regional configuration with CPM targets and style preferences
const REGIONAL_CONFIG: Record<
  string,
  {
    language: 'en' | 'zh' | 'es' | 'ja' | 'de';
    targetCpm: number;
    priority: 'primary' | 'secondary';
    titleStyle: string;
    descriptionStyle: string;
    culturalNotes: string;
  }
> = {
  'en-US': {
    language: 'en',
    targetCpm: 15,
    priority: 'primary',
    titleStyle: 'direct',
    descriptionStyle: 'detailed',
    culturalNotes: 'Use action verbs, numbers, and clear value propositions'
  },
  'ja-JP': {
    language: 'ja',
    targetCpm: 12,
    priority: 'primary',
    titleStyle: 'polite',
    descriptionStyle: 'formal',
    culturalNotes: 'Use polite language, avoid overly casual expressions'
  },
  'zh-CN': {
    language: 'zh',
    targetCpm: 6,
    priority: 'primary',
    titleStyle: 'attention-grabbing',
    descriptionStyle: 'concise',
    culturalNotes: 'Maximize attention with short, punchy phrases'
  },
  'de-DE': {
    language: 'de',
    targetCpm: 8,
    priority: 'secondary',
    titleStyle: 'informative',
    descriptionStyle: 'structured',
    culturalNotes: 'Precision and accuracy valued over hype'
  },
  'es-ES': {
    language: 'es',
    targetCpm: 5,
    priority: 'secondary',
    titleStyle: 'engaging',
    descriptionStyle: 'warm',
    culturalNotes: 'Personal, warm tone; community-focused language'
  },
  'es-MX': {
    language: 'es',
    targetCpm: 4,
    priority: 'secondary',
    titleStyle: 'colloquial',
    descriptionStyle: 'friendly',
    culturalNotes: 'More casual than Spain; local idioms appreciated'
  }
};

// Content type to market mapping (which markets respond best to which content)
const CONTENT_TYPE_MARKETS: Record<string, string[]> = {
  tech: ['en-US', 'ja-JP', 'de-DE'],
  entertainment: ['en-US', 'es-MX', 'zh-CN'],
  business: ['en-US', 'ja-JP', 'de-DE'],
  lifestyle: ['en-US', 'es-ES', 'zh-CN'],
  gaming: ['en-US', 'ja-JP', 'zh-CN'],
  education: ['en-US', 'ja-JP', 'de-DE', 'zh-CN']
};

/**
 * Optimizes SEO content for multiple regional markets
 */
export class RegionalSEOOptimizer {
  constructor(private geminiClient: GeminiClient) {}

  /**
   * Generate region-optimized SEO for all target markets
   */
  async generateRegionalSEO(
    projectId: string,
    baseSeo: Pick<SEOData, 'tags' | 'entities'>,
    content: string,
    targetRegions?: string[]
  ): Promise<z.infer<typeof RegionalSEOSchema>[]> {
    // Determine content type for market selection
    const contentType = await this.detectContentType(projectId, content);

    // Select target regions if not specified
    const regions = targetRegions || this.decidePrimaryMarkets(contentType);

    logger.info('Starting regional SEO optimization', {
      projectId,
      contentType,
      regions
    });

    // Generate SEO for each region in parallel
    const regionalResults = await Promise.all(
      regions.map((region) =>
        this.generateForRegion(projectId, content, baseSeo, region)
      )
    );

    // Filter out any failed generations
    const validResults = regionalResults.filter(
      (r): r is z.infer<typeof RegionalSEOSchema> => r !== null
    );

    logger.info('Regional SEO optimization complete', {
      projectId,
      successCount: validResults.length,
      totalRegions: regions.length
    });

    return validResults;
  }

  /**
   * Detect content type from content analysis
   */
  private async detectContentType(
    projectId: string,
    content: string
  ): Promise<string> {
    const prompt = `
Classify this content into ONE category:
- tech (programming, software, technology)
- entertainment (movies, music, pop culture)
- business (entrepreneurship, finance, marketing)
- lifestyle (health, fitness, personal development)
- gaming (video games, esports)
- education (tutorials, courses, learning)

CONTENT:
${content.slice(0, 1500)}

Output ONLY the category name, nothing else.
`;

    try {
      const result = await this.geminiClient.generate(prompt, {
        projectId,
        priority: 'low'
      });
      return result.text.trim().toLowerCase();
    } catch {
      return 'education'; // Default fallback
    }
  }

  /**
   * Decide primary markets based on content type
   */
  decidePrimaryMarkets(contentType: string): string[] {
    const markets = CONTENT_TYPE_MARKETS[contentType] || CONTENT_TYPE_MARKETS['education'] || [];

    // Always include at least 2 markets, prioritizing by CPM
    if (markets.length < 2) {
      const allRegions = Object.keys(REGIONAL_CONFIG);
      const sortedByCpm = allRegions.sort(
        (a, b) =>
          (REGIONAL_CONFIG[b]?.targetCpm || 0) -
          (REGIONAL_CONFIG[a]?.targetCpm || 0)
      );
      return sortedByCpm.slice(0, 3);
    }

    return markets;
  }

  /**
   * Generate SEO for a specific region
   */
  private async generateForRegion(
    projectId: string,
    content: string,
    baseSeo: Pick<SEOData, 'tags' | 'entities'>,
    region: string
  ): Promise<z.infer<typeof RegionalSEOSchema> | null> {
    const config = REGIONAL_CONFIG[region];
    if (!config) {
      logger.warn('Unknown region, skipping', { projectId, region });
      return null;
    }

    const prompt = `
Generate YouTube SEO optimized for ${region} market.

CONTENT:
${content.slice(0, 2000)}

BASE TAGS: ${baseSeo.tags.slice(0, 15).join(', ')}
ENTITIES: ${baseSeo.entities.map((e) => e.name).join(', ')}

REGIONAL REQUIREMENTS:
- Language: ${config.language}
- Title style: ${config.titleStyle}
- Description style: ${config.descriptionStyle}
- Cultural notes: ${config.culturalNotes}

GENERATE:
1. 5 titles (optimized for ${config.titleStyle} style)
2. A description (max 5000 chars, ${config.descriptionStyle} style)
3. 3 cultural hooks (phrases that resonate with ${region} audience)

Output as JSON:
{
  "titles": ["title1", "title2", "title3", "title4", "title5"],
  "description": "full description",
  "cultural_hooks": ["hook1", "hook2", "hook3"]
}
`;

    try {
      const result = await this.geminiClient.generate(prompt, {
        projectId,
        priority: 'medium'
      });

      const parsed = JSON.parse(result.text);

      return {
        language: config.language,
        titles: parsed.titles.slice(0, 5),
        description: parsed.description.slice(0, 5000),
        cultural_hooks: parsed.cultural_hooks.slice(0, 3),
        contains_established_trend: false // Will be updated by SEO expert
      };
    } catch (error) {
      logger.error('Regional SEO generation failed', {
        projectId,
        region,
        error: (error as Error).message
      });
      return null;
    }
  }

  /**
   * Translate and optimize text for a specific region
   */
  async translateAndOptimize(
    projectId: string,
    text: string,
    fromLang: string,
    toRegion: string
  ): Promise<string> {
    const config = REGIONAL_CONFIG[toRegion];
    if (!config) {
      throw new Error(`Unknown region: ${toRegion}`);
    }

    const prompt = `
Translate and culturally adapt the following text from ${fromLang} to ${config.language} for ${toRegion} audience.

ORIGINAL TEXT:
${text}

ADAPTATION REQUIREMENTS:
- Style: ${config.titleStyle}
- Cultural notes: ${config.culturalNotes}

Do NOT simply translate. Adapt the message to resonate with the target audience.

Output ONLY the adapted text, nothing else.
`;

    const result = await this.geminiClient.generate(prompt, {
      projectId,
      priority: 'low'
    });

    return result.text.trim();
  }

  /**
   * Get CPM estimate for a region
   */
  getRegionCPM(region: string): number {
    return REGIONAL_CONFIG[region]?.targetCpm || 5;
  }

  /**
   * Calculate total potential revenue across regions
   */
  calculatePotentialRevenue(
    regions: string[],
    estimatedViews: number
  ): { region: string; estimatedRevenue: number }[] {
    return regions.map((region) => {
      const cpm = this.getRegionCPM(region);
      const estimatedRevenue = (estimatedViews / 1000) * cpm;
      return { region, estimatedRevenue };
    });
  }

  /**
   * Get all supported regions
   */
  getSupportedRegions(): string[] {
    return Object.keys(REGIONAL_CONFIG);
  }

  /**
   * Get primary regions (highest CPM markets)
   */
  getPrimaryRegions(): string[] {
    return Object.entries(REGIONAL_CONFIG)
      .filter(([_, config]) => config.priority === 'primary')
      .map(([region]) => region);
  }
}
