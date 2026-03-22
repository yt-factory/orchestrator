import type { ChannelProfile } from '../core/channel-profile';
import type { GeminiClient } from '../agents/gemini-client';
import { safeJsonParse } from '../utils/json-parse';
import { logger } from '../utils/logger';

// ============================================
// Types
// ============================================

interface TitleRanking {
  index: number;
  total_score: number;
}

interface RankingResponse {
  rankings: TitleRanking[];
  best_index: number;
}

// ============================================
// Prompt Builder
// ============================================

/**
 * Build a concise prompt asking Gemini to score titles for CTR potential.
 * Designed for a Flash-model call -- kept short to minimize token usage.
 */
export function buildTitleRankingPrompt(
  titles: string[],
  profile: ChannelProfile,
  coreFacts: string[],
): string {
  const titlesBlock = titles
    .map((t, i) => `${i}. ${t}`)
    .join('\n');

  const factsSummary = coreFacts.slice(0, 3).join('\n');

  return `Rate these YouTube titles for CTR potential.

Channel: ${profile.channel_name} (${profile.niche})
Audience: ${profile.audience.demographics}
Title style: ${profile.quality.title_style}

Content summary:
${factsSummary}

Titles:
${titlesBlock}

Score each title 1-10 on: curiosity_gap, clarity, audience_fit, uniqueness.
Sum the four scores into total_score.

Output JSON only:
{ "rankings": [{ "index": number, "total_score": number }], "best_index": number }`;
}

// ============================================
// Ranking Execution
// ============================================

/**
 * Call Gemini to rank titles by CTR potential, returning them sorted best-first.
 *
 * Uses priority 'low' since this is a supplementary ranking step.
 * On any error, logs a warning and returns titles in their original order (fail-safe).
 */
export async function rankTitles(
  titles: string[],
  profile: ChannelProfile,
  coreFacts: string[],
  geminiClient: GeminiClient,
  projectId: string,
): Promise<string[]> {
  if (titles.length === 0) {
    return [];
  }

  try {
    const prompt = buildTitleRankingPrompt(titles, profile, coreFacts);

    const result = await geminiClient.generate(prompt, {
      projectId,
      priority: 'low',
    });

    const parsed = safeJsonParse<RankingResponse>(result.text, {
      projectId,
      operation: 'rankTitles',
    });

    const rankings = parsed.rankings;
    if (!Array.isArray(rankings) || rankings.length === 0) {
      logger.warn('Title ranking response missing rankings array', { projectId });
      return titles;
    }

    // Sort rankings by total_score descending
    const sorted = [...rankings].sort((a, b) => b.total_score - a.total_score);

    // Map sorted rankings back to title strings, skipping invalid indices
    const reordered: string[] = [];
    for (const ranking of sorted) {
      const title = titles[ranking.index];
      if (title !== undefined) {
        reordered.push(title);
      }
    }

    // If mapping produced fewer titles than expected, append any missing ones
    if (reordered.length < titles.length) {
      for (const title of titles) {
        if (!reordered.includes(title)) {
          reordered.push(title);
        }
      }
    }

    return reordered;
  } catch (error) {
    logger.warn('Title ranking failed, returning titles unchanged', {
      projectId,
      error: (error as Error).message,
    });
    return titles;
  }
}
