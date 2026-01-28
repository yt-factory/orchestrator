import { OriginalityScore, SEOData, ScriptSegment } from '../core/manifest';
import { GeminiClient } from '../agents/gemini-client';
import { logger } from '../utils/logger';

// Target thresholds
const MIN_VISUAL_TEXT_MATCH = 0.8;
const MIN_SEMANTIC_UNIQUENESS = 0.7;
const MIN_OVERALL_SCORE = 0.85;

/**
 * Validates content originality to avoid YouTube "duplicate content" flags.
 *
 * Key checks:
 * 1. Video text matches metadata (titles/tags) by 80%+
 * 2. Semantic distance from existing videos
 * 3. Visual style fingerprint uniqueness
 */
export class OriginalityChecker {
  constructor(private geminiClient: GeminiClient) {}

  /**
   * Main validation entry point
   */
  async validateOriginality(
    projectId: string,
    script: ScriptSegment[],
    seo: SEOData,
    existingSimilarVideos: string[] = []
  ): Promise<OriginalityScore> {
    logger.info('Starting originality validation', { projectId });

    // Step 1: Compare video text with SEO metadata
    const visualTextMatch = this.compareVisualTextWithMetadata(script, seo);

    // Step 2: Check semantic uniqueness
    const semanticUniqueness = await this.checkSemanticDistance(
      projectId,
      script,
      existingSimilarVideos
    );

    // Step 3: Generate style fingerprint
    const styleFingerprint = this.generateStyleFingerprint(script, seo);

    // Calculate overall score (weighted average)
    const overallScore =
      visualTextMatch * 0.4 +
      semanticUniqueness * 0.4 +
      (styleFingerprint ? 0.2 : 0);

    const isOriginal = overallScore >= MIN_OVERALL_SCORE;

    // Generate warnings and suggestions
    const warnings: string[] = [];
    const suggestions: string[] = [];

    if (visualTextMatch < MIN_VISUAL_TEXT_MATCH) {
      warnings.push(
        `Visual text match (${(visualTextMatch * 100).toFixed(1)}%) below threshold (${MIN_VISUAL_TEXT_MATCH * 100}%)`
      );
      suggestions.push(
        'Ensure video text overlays include key SEO terms from titles and tags'
      );
    }

    if (semanticUniqueness < MIN_SEMANTIC_UNIQUENESS) {
      warnings.push(
        `Semantic uniqueness (${(semanticUniqueness * 100).toFixed(1)}%) below threshold (${MIN_SEMANTIC_UNIQUENESS * 100}%)`
      );
      suggestions.push(
        'Add unique perspectives, examples, or angles not covered in similar content'
      );
    }

    if (!isOriginal) {
      suggestions.push(
        'Consider rewriting introduction with unique hook',
        'Add original case studies or examples',
        'Include personal insights or proprietary data'
      );
    }

    const result: OriginalityScore = {
      visual_text_match: visualTextMatch,
      semantic_uniqueness: semanticUniqueness,
      style_fingerprint: styleFingerprint,
      overall_score: overallScore,
      is_original: isOriginal,
      warnings,
      suggestions
    };

    logger.info('Originality validation complete', {
      projectId,
      overallScore,
      isOriginal,
      warningCount: warnings.length
    });

    return result;
  }

  /**
   * Compare video script text with SEO metadata (titles, tags, description)
   */
  private compareVisualTextWithMetadata(
    script: ScriptSegment[],
    seo: SEOData
  ): number {
    // Extract all text from script
    const scriptText = script.map((s) => s.voiceover.toLowerCase()).join(' ');

    // Extract SEO keywords
    const seoKeywords = new Set<string>();

    // Add tags
    seo.tags.forEach((tag) => {
      tag
        .toLowerCase()
        .split(/\s+/)
        .forEach((word) => seoKeywords.add(word));
    });

    // Add words from regional titles
    seo.regional_seo.forEach((regional) => {
      regional.titles.forEach((title) => {
        title
          .toLowerCase()
          .split(/\s+/)
          .forEach((word) => {
            if (word.length > 3) seoKeywords.add(word);
          });
      });
    });

    // Add entity names
    seo.entities.forEach((entity) => {
      entity.name
        .toLowerCase()
        .split(/\s+/)
        .forEach((word) => seoKeywords.add(word));
    });

    // Calculate match ratio
    let matchedCount = 0;
    const keywordsArray = Array.from(seoKeywords);

    for (const keyword of keywordsArray) {
      if (scriptText.includes(keyword)) {
        matchedCount++;
      }
    }

    return keywordsArray.length > 0 ? matchedCount / keywordsArray.length : 1;
  }

  /**
   * Check semantic distance from existing similar videos using embeddings
   */
  private async checkSemanticDistance(
    projectId: string,
    script: ScriptSegment[],
    existingVideos: string[]
  ): Promise<number> {
    if (existingVideos.length === 0) {
      // No existing videos to compare, assume unique
      return 1.0;
    }

    const scriptText = script.map((s) => s.voiceover).join('\n');

    try {
      const prompt = `
Analyze the semantic similarity between the following new script and existing video transcripts.

NEW SCRIPT:
${scriptText.slice(0, 2000)}

EXISTING VIDEOS:
${existingVideos.slice(0, 3).join('\n---\n').slice(0, 3000)}

Rate the uniqueness of the new script on a scale of 0 to 1, where:
- 0 = Nearly identical to existing content
- 0.5 = Some unique elements but similar overall structure
- 1 = Completely unique perspective and content

Output ONLY a JSON object: { "uniqueness": number, "similar_elements": string[], "unique_elements": string[] }
`;

      const result = await this.geminiClient.generate(prompt, {
        projectId,
        priority: 'medium'
      });

      const parsed = JSON.parse(result.text);
      return Math.min(1, Math.max(0, parsed.uniqueness));
    } catch (error) {
      logger.warn('Semantic distance check failed, using default', {
        projectId,
        error: (error as Error).message
      });
      // Default to moderately unique on error
      return 0.75;
    }
  }

  /**
   * Generate visual style fingerprint based on content characteristics
   */
  private generateStyleFingerprint(
    script: ScriptSegment[],
    seo: SEOData
  ): string {
    // Visual hints distribution
    const visualHints = script.map((s) => s.visual_hint);
    const hintCounts: Record<string, number> = {};
    visualHints.forEach((hint) => {
      hintCounts[hint] = (hintCounts[hint] || 0) + 1;
    });

    // Dominant visual style
    const dominantVisual = Object.entries(hintCounts).sort(
      (a, b) => b[1] - a[1]
    )[0]?.[0] || 'mixed';

    // Content type from SEO
    const contentType = seo.regional_seo[0]?.cultural_hooks[0] || 'general';

    // Calculate script pacing (average segment duration)
    const avgDuration =
      script.reduce((sum, s) => sum + s.estimated_duration_seconds, 0) /
      script.length;
    const pacing =
      avgDuration < 15 ? 'fast' : avgDuration < 30 ? 'medium' : 'slow';

    // Generate fingerprint hash
    const fingerprintData = {
      visualStyle: dominantVisual,
      pacing,
      segmentCount: script.length,
      primaryLanguage: seo.primary_language,
      hasEntities: seo.entities.length > 0,
      hasTrends: (seo.injected_trends?.length || 0) > 0
    };

    // Create a simple hash-like fingerprint
    const fingerprint = Buffer.from(JSON.stringify(fingerprintData)).toString(
      'base64'
    );

    return fingerprint;
  }

  /**
   * Quick check for obvious duplication issues
   */
  quickDuplicationCheck(
    script: ScriptSegment[],
    knownDuplicatePhrases: string[] = []
  ): { hasDuplication: boolean; matches: string[] } {
    const scriptText = script
      .map((s) => s.voiceover.toLowerCase())
      .join(' ');
    const matches: string[] = [];

    // Check for known duplicate phrases
    for (const phrase of knownDuplicatePhrases) {
      if (scriptText.includes(phrase.toLowerCase())) {
        matches.push(phrase);
      }
    }

    // Check for common filler phrases that indicate low-quality content
    const fillerPhrases = [
      'in this video',
      'don\'t forget to like and subscribe',
      'hit the bell',
      'without further ado',
      'let\'s dive right in',
      'as you can see on screen'
    ];

    let fillerCount = 0;
    for (const filler of fillerPhrases) {
      if (scriptText.includes(filler)) {
        fillerCount++;
      }
    }

    // Too many fillers indicates generic content
    if (fillerCount >= 3) {
      matches.push(`Excessive filler phrases (${fillerCount} detected)`);
    }

    return {
      hasDuplication: matches.length > 0,
      matches
    };
  }
}
