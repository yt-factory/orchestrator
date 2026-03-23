import { writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { logger } from '../utils/logger';
import { ChannelProfileManager, ChannelProfile } from '../core/channel-profile';
import { QualityScores } from '../core/manifest';

// ============================================
// Interfaces
// ============================================

export interface VideoPerformance {
  projectId: string;
  videoId: string;
  title: string;
  publishedAt: string;
  metrics: {
    views: number;
    likes: number;
    comments: number;
    shares: number;
    averageViewDuration: number;
    averageViewPercentage: number;
    clickThroughRate: number;
    subscriberGained: number;
  };
  manifest: {
    quality_scores?: QualityScores;
    emotional_triggers: string[];
    content_type: string;
    segment_count: number;
    estimated_duration: number;
  };
}

export interface FeedbackReport {
  videosAnalyzed: number;
  period: { from: string; to: string };
  insights: {
    bestTitlePatterns: string[];
    worstTitlePatterns: string[];
    bestEmotionalTriggers: string[];
    optimalSegmentCount: { min: number; max: number };
    optimalDuration: { min: number; max: number };
    confidenceCorrelation: number;
  };
  profileUpdates: Partial<ChannelProfile>;
  applied: boolean;
}

// ============================================
// Title Pattern Extraction
// ============================================

const ACTION_VERBS = /\b(?:build|create|make|use|learn|master|deploy|design|setup|install|configure|optimize|debug|test|write|develop)\b/gi;

/**
 * Extracts a reusable pattern from a video title by replacing
 * numbers, proper nouns, and action verbs with template tokens.
 */
export function extractTitlePattern(title: string): string {
  return title
    .replace(/\b\d+\b/g, '{Number}')
    .replace(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g, '{Topic}')
    .replace(ACTION_VERBS, '{Action}');
}

// ============================================
// Statistical Helpers
// ============================================

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
  }
  return sorted[mid] ?? 0;
}

/**
 * Computes the Pearson correlation coefficient between two arrays.
 * Returns 0 when there are fewer than 2 paired observations.
 */
function pearsonCorrelation(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return 0;

  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumX2 = 0;
  let sumY2 = 0;

  for (let i = 0; i < n; i++) {
    const x = xs[i] ?? 0;
    const y = ys[i] ?? 0;
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumX2 += x * x;
    sumY2 += y * y;
  }

  const numerator = n * sumXY - sumX * sumY;
  const denominator = Math.sqrt(
    (n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY)
  );

  if (denominator === 0) return 0;
  return numerator / denominator;
}

// ============================================
// AnalyticsFeedbackService
// ============================================

export class AnalyticsFeedbackService {
  private readonly profileManager: ChannelProfileManager;

  constructor(profileManager?: ChannelProfileManager) {
    this.profileManager = profileManager ?? new ChannelProfileManager();
  }

  /**
   * Analyzes a set of video performances and produces a FeedbackReport
   * with actionable insights for the channel profile.
   */
  analyze(performances: VideoPerformance[]): FeedbackReport {
    const emptyReport: FeedbackReport = {
      videosAnalyzed: 0,
      period: { from: '', to: '' },
      insights: {
        bestTitlePatterns: [],
        worstTitlePatterns: [],
        bestEmotionalTriggers: [],
        optimalSegmentCount: { min: 0, max: 0 },
        optimalDuration: { min: 0, max: 0 },
        confidenceCorrelation: 0,
      },
      profileUpdates: {},
      applied: false,
    };

    if (performances.length === 0) {
      logger.info('No performances to analyze, returning empty report');
      return emptyReport;
    }

    // --- Period ---
    const dates = performances
      .map((p) => p.publishedAt)
      .sort();
    const periodFrom = dates[0] ?? '';
    const periodTo = dates[dates.length - 1] ?? '';

    // --- Title pattern analysis (median CTR split) ---
    const ctrs = performances.map((p) => p.metrics.clickThroughRate);
    const medianCtr = median(ctrs);

    const bestTitles = performances.filter(
      (p) => p.metrics.clickThroughRate >= medianCtr
    );
    const worstTitles = performances.filter(
      (p) => p.metrics.clickThroughRate < medianCtr
    );

    const bestTitlePatterns = dedupStrings(
      bestTitles.map((p) => extractTitlePattern(p.title))
    );
    const worstTitlePatterns = dedupStrings(
      worstTitles.map((p) => extractTitlePattern(p.title))
    );

    // --- Emotional trigger ranking by engagement rate ---
    const triggerEngagement = new Map<string, { totalEngagement: number; totalViews: number }>();

    for (const perf of performances) {
      const engagementRate =
        perf.metrics.views > 0
          ? (perf.metrics.likes + perf.metrics.comments + perf.metrics.shares) /
            perf.metrics.views
          : 0;

      for (const trigger of perf.manifest.emotional_triggers) {
        const existing = triggerEngagement.get(trigger) ?? {
          totalEngagement: 0,
          totalViews: 0,
        };
        triggerEngagement.set(trigger, {
          totalEngagement: existing.totalEngagement + engagementRate,
          totalViews: existing.totalViews + 1,
        });
      }
    }

    const bestEmotionalTriggers = [...triggerEngagement.entries()]
      .map(([trigger, stats]) => ({
        trigger,
        avgEngagement: stats.totalViews > 0 ? stats.totalEngagement / stats.totalViews : 0,
      }))
      .sort((a, b) => b.avgEngagement - a.avgEngagement)
      .map((entry) => entry.trigger);

    // --- Optimal segment count (top 50% by CTR) ---
    const sortedByCtr = [...performances].sort(
      (a, b) => b.metrics.clickThroughRate - a.metrics.clickThroughRate
    );
    const topHalf = sortedByCtr.slice(0, Math.max(1, Math.ceil(sortedByCtr.length / 2)));
    const topSegmentCounts = topHalf.map((p) => p.manifest.segment_count);
    const optimalSegmentCount = {
      min: Math.min(...topSegmentCounts),
      max: Math.max(...topSegmentCounts),
    };

    // --- Optimal duration (top 50% by CTR) ---
    const topDurations = topHalf.map((p) => p.manifest.estimated_duration);
    const optimalDuration = {
      min: Math.min(...topDurations),
      max: Math.max(...topDurations),
    };

    // --- Confidence correlation (Pearson: script_confidence vs CTR) ---
    const confidencePairs = performances
      .filter((p) => p.manifest.quality_scores?.script_confidence != null)
      .map((p) => ({
        confidence: p.manifest.quality_scores?.script_confidence ?? 0,
        ctr: p.metrics.clickThroughRate,
      }));

    const confidenceCorrelation = pearsonCorrelation(
      confidencePairs.map((pair) => pair.confidence),
      confidencePairs.map((pair) => pair.ctr)
    );

    // --- Build profile update suggestions ---
    const profileUpdates: Partial<ChannelProfile> = {
      seo: {
        target_regions: ['en'],
        keyword_style: 'mixed',
        title_patterns: bestTitlePatterns.slice(0, 10),
        avoid_patterns: worstTitlePatterns.slice(0, 10),
      },
    };

    const report: FeedbackReport = {
      videosAnalyzed: performances.length,
      period: { from: periodFrom, to: periodTo },
      insights: {
        bestTitlePatterns,
        worstTitlePatterns,
        bestEmotionalTriggers,
        optimalSegmentCount,
        optimalDuration,
        confidenceCorrelation,
      },
      profileUpdates,
      applied: false,
    };

    logger.info('Feedback analysis complete', {
      videosAnalyzed: report.videosAnalyzed,
      bestPatterns: bestTitlePatterns.length,
      worstPatterns: worstTitlePatterns.length,
      triggers: bestEmotionalTriggers.length,
      confidenceCorrelation: Math.round(confidenceCorrelation * 1000) / 1000,
    });

    return report;
  }

  /**
   * Applies a feedback report's insights to the channel profile.
   * Merges new patterns (deduped, max 10), adjusts confidence threshold
   * based on correlation data, and writes the updated profile to disk.
   */
  async applyToProfile(
    channelId: string,
    report: FeedbackReport
  ): Promise<void> {
    const profile = await this.profileManager.load(channelId);

    // --- Merge title_patterns (dedup, max 10) ---
    const existingTitlePatterns = profile.seo.title_patterns;
    const newTitlePatterns = report.insights.bestTitlePatterns;
    const mergedTitlePatterns = dedupStrings([
      ...existingTitlePatterns,
      ...newTitlePatterns,
    ]).slice(0, 10);

    // --- Merge avoid_patterns (dedup, max 10) ---
    const existingAvoidPatterns = profile.seo.avoid_patterns;
    const newAvoidPatterns = report.insights.worstTitlePatterns;
    const mergedAvoidPatterns = dedupStrings([
      ...existingAvoidPatterns,
      ...newAvoidPatterns,
    ]).slice(0, 10);

    // --- Adjust min_confidence_score based on correlation ---
    let updatedConfidence = profile.quality.min_confidence_score;
    const correlation = report.insights.confidenceCorrelation;

    if (correlation < 0.3 && updatedConfidence > 5) {
      // Self-scoring is not predictive; lower the threshold
      updatedConfidence = Math.max(5, updatedConfidence - 1);
      logger.info('Lowering min_confidence_score (weak correlation)', {
        channelId,
        correlation,
        oldScore: profile.quality.min_confidence_score,
        newScore: updatedConfidence,
      });
    } else if (correlation > 0.6 && updatedConfidence < 9) {
      // Self-scoring is predictive; raise the threshold
      updatedConfidence = Math.min(9, updatedConfidence + 1);
      logger.info('Raising min_confidence_score (strong correlation)', {
        channelId,
        correlation,
        oldScore: profile.quality.min_confidence_score,
        newScore: updatedConfidence,
      });
    }

    // --- Build updated profile (immutable) ---
    const updatedProfile: ChannelProfile = {
      ...profile,
      seo: {
        ...profile.seo,
        title_patterns: mergedTitlePatterns,
        avoid_patterns: mergedAvoidPatterns,
      },
      quality: {
        ...profile.quality,
        min_confidence_score: updatedConfidence,
      },
    };

    // --- Write to disk ---
    const profilePath = join('./channels', channelId, 'profile.json');
    await mkdir(dirname(profilePath), { recursive: true });
    await writeFile(profilePath, JSON.stringify(updatedProfile, null, 2));

    logger.info('Channel profile updated with feedback insights', {
      channelId,
      titlePatternsCount: mergedTitlePatterns.length,
      avoidPatternsCount: mergedAvoidPatterns.length,
      minConfidenceScore: updatedConfidence,
      profilePath,
    });
  }
}

// ============================================
// Utility
// ============================================

function dedupStrings(items: string[]): string[] {
  return [...new Set(items)];
}
