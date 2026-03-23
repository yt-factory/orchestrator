/**
 * CLI command: Analytics Feedback Loop
 *
 * Analyzes completed project manifests, extracts performance insights,
 * and optionally applies learned patterns back to the channel profile.
 *
 * Usage:
 *   bun run src/cli/feedback.ts [--channel=default] [--days=30] [--dry-run]
 *
 * Flags:
 *   --channel=<id>  Channel profile to analyze/update (default: 'default')
 *   --days=<n>      Only analyze videos from the last N days (default: 30)
 *   --dry-run       Show report without applying changes to the profile
 */

import { logger } from '../utils/logger';
import {
  loadCompletedProjects,
  extractVideoPerformance,
  generateMockMetrics,
} from '../services/performance-loader';
import {
  AnalyticsFeedbackService,
  type FeedbackReport,
  type VideoPerformance,
} from '../services/analytics-feedback';
import { ChannelProfileManager } from '../core/channel-profile';

// ============================================
// ANSI color helpers (no external deps)
// ============================================

const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const MAGENTA = '\x1b[35m';
const WHITE = '\x1b[37m';

// ============================================
// Argument Parsing
// ============================================

interface CliArgs {
  channel: string;
  days: number;
  dryRun: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    channel: 'default',
    days: 30,
    dryRun: false,
  };

  // Skip first two entries: [bun, script-path]
  const cliArgs = argv.slice(2);

  for (const arg of cliArgs) {
    if (arg === '--dry-run') {
      args.dryRun = true;
      continue;
    }

    const channelMatch = arg.match(/^--channel=(.+)$/);
    if (channelMatch) {
      const value = channelMatch[1];
      if (value != null && value.length > 0) {
        args.channel = value;
      }
      continue;
    }

    const daysMatch = arg.match(/^--days=(\d+)$/);
    if (daysMatch) {
      const value = daysMatch[1];
      if (value != null) {
        const parsed = parseInt(value, 10);
        if (!Number.isNaN(parsed) && parsed > 0) {
          args.days = parsed;
        }
      }
      continue;
    }
  }

  return args;
}

// ============================================
// Date Filtering
// ============================================

function filterByDate<T extends { publishedAt: string }>(
  items: T[],
  days: number
): T[] {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffIso = cutoff.toISOString();

  return items.filter((item) => item.publishedAt >= cutoffIso);
}

// ============================================
// Report Formatting
// ============================================

function printHeader(text: string): void {
  const line = '='.repeat(60);
  console.log(`\n${CYAN}${line}${RESET}`);
  console.log(`${CYAN}${BOLD}  ${text}${RESET}`);
  console.log(`${CYAN}${line}${RESET}\n`);
}

function printSection(title: string): void {
  console.log(`\n${MAGENTA}${BOLD}--- ${title} ---${RESET}\n`);
}

function printKeyValue(key: string, value: string | number): void {
  console.log(`  ${DIM}${key}:${RESET} ${WHITE}${value}${RESET}`);
}

function printList(items: string[], color: string = WHITE): void {
  if (items.length === 0) {
    console.log(`  ${DIM}(none)${RESET}`);
    return;
  }
  for (const item of items) {
    console.log(`  ${color}- ${item}${RESET}`);
  }
}

function printReport(report: FeedbackReport, dryRun: boolean): void {
  printHeader('Analytics Feedback Report');

  // Overview
  printSection('Overview');
  printKeyValue('Videos analyzed', report.videosAnalyzed);
  printKeyValue('Period', `${report.period.from || 'N/A'} to ${report.period.to || 'N/A'}`);
  printKeyValue('Mode', dryRun ? `${YELLOW}DRY RUN${RESET}` : `${GREEN}LIVE${RESET}`);

  // Best title patterns
  printSection('Best Title Patterns (above-median CTR)');
  printList(report.insights.bestTitlePatterns, GREEN);

  // Worst title patterns
  printSection('Worst Title Patterns (below-median CTR)');
  printList(report.insights.worstTitlePatterns, RED);

  // Emotional triggers
  printSection('Top Emotional Triggers (by engagement rate)');
  printList(report.insights.bestEmotionalTriggers, YELLOW);

  // Optimal ranges
  printSection('Optimal Ranges (from top-performing videos)');
  const segMin = report.insights.optimalSegmentCount.min;
  const segMax = report.insights.optimalSegmentCount.max;
  printKeyValue('Segment count', `${segMin} - ${segMax}`);
  const durMin = report.insights.optimalDuration.min;
  const durMax = report.insights.optimalDuration.max;
  printKeyValue('Duration (seconds)', `${durMin} - ${durMax}`);

  // Confidence correlation
  printSection('Confidence Correlation');
  const corr = report.insights.confidenceCorrelation;
  const corrFormatted = corr.toFixed(3);
  let corrLabel: string;
  if (corr > 0.6) {
    corrLabel = `${GREEN}STRONG${RESET} - self-scoring predicts performance well`;
  } else if (corr > 0.3) {
    corrLabel = `${YELLOW}MODERATE${RESET} - some predictive value`;
  } else {
    corrLabel = `${RED}WEAK${RESET} - self-scoring is not predictive`;
  }
  printKeyValue('Pearson r', `${corrFormatted} (${corrLabel})`);

  // Profile updates
  printSection('Profile Updates');
  const seoUpdates = report.profileUpdates.seo;
  if (seoUpdates) {
    const titleCount = seoUpdates.title_patterns?.length ?? 0;
    const avoidCount = seoUpdates.avoid_patterns?.length ?? 0;
    printKeyValue('New title patterns', titleCount);
    printKeyValue('New avoid patterns', avoidCount);
  } else {
    console.log(`  ${DIM}No profile updates suggested${RESET}`);
  }
}

function printApplySummary(channelId: string, report: FeedbackReport): void {
  printSection('Changes Applied');
  console.log(`  ${GREEN}Channel profile "${channelId}" has been updated:${RESET}`);
  const titleCount = report.insights.bestTitlePatterns.length;
  const avoidCount = report.insights.worstTitlePatterns.length;
  printKeyValue('Title patterns merged', `up to ${titleCount} new (deduped, max 10)`);
  printKeyValue('Avoid patterns merged', `up to ${avoidCount} new (deduped, max 10)`);

  const corr = report.insights.confidenceCorrelation;
  if (corr < 0.3) {
    printKeyValue('Confidence threshold', `${YELLOW}lowered${RESET} (weak correlation)`);
  } else if (corr > 0.6) {
    printKeyValue('Confidence threshold', `${GREEN}raised${RESET} (strong correlation)`);
  } else {
    printKeyValue('Confidence threshold', 'unchanged');
  }
}

function printEmptyState(): void {
  printHeader('Analytics Feedback Report');
  console.log(`  ${YELLOW}No completed projects found in the analysis period.${RESET}`);
  console.log('');
  console.log(`  ${DIM}To generate data for analysis:${RESET}`);
  console.log(`  ${DIM}  1. Drop a markdown file into ./incoming/${RESET}`);
  console.log(`  ${DIM}  2. Wait for the orchestrator to process it to completion${RESET}`);
  console.log(`  ${DIM}  3. Re-run: bun run feedback --days=30${RESET}`);
  console.log('');
}

// ============================================
// Main
// ============================================

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  logger.info('Feedback CLI started', {
    channel: args.channel,
    days: args.days,
    dryRun: args.dryRun,
  });

  // Step A: Load completed project manifests
  const manifests = await loadCompletedProjects();

  if (manifests.length === 0) {
    printEmptyState();
    return;
  }

  // Step B: Extract VideoPerformance from each manifest (with mock metrics)
  const allPerformances: VideoPerformance[] = [];
  for (const manifest of manifests) {
    const perf = extractVideoPerformance(manifest);
    if (perf == null) {
      continue;
    }
    // Inject mock metrics since real YouTube analytics are not yet available
    const withMockMetrics: VideoPerformance = {
      ...perf,
      metrics: generateMockMetrics(),
    };
    allPerformances.push(withMockMetrics);
  }

  // Step C: Filter by date (last N days based on publishedAt / created_at)
  const filtered = filterByDate(allPerformances, args.days);

  if (filtered.length === 0) {
    printEmptyState();
    console.log(
      `  ${DIM}(${allPerformances.length} project(s) exist but fall outside the --days=${args.days} window)${RESET}\n`
    );
    return;
  }

  // Step D: Run analysis
  const profileManager = new ChannelProfileManager();
  const feedbackService = new AnalyticsFeedbackService(profileManager);
  const report = feedbackService.analyze(filtered);

  // Step E: Print formatted report
  printReport(report, args.dryRun);

  // Step F: If not --dry-run, apply profile updates
  if (!args.dryRun) {
    try {
      await feedbackService.applyToProfile(args.channel, report);
      printApplySummary(args.channel, report);
    } catch (error) {
      console.log(
        `\n  ${RED}Failed to apply profile updates: ${(error as Error).message}${RESET}\n`
      );
      logger.error('Failed to apply feedback to profile', {
        channel: args.channel,
        error: (error as Error).message,
      });
      process.exit(1);
    }
  } else {
    console.log(
      `\n  ${DIM}Dry run complete. No changes were applied.${RESET}`
    );
    console.log(
      `  ${DIM}Run without --dry-run to apply updates to the "${args.channel}" profile.${RESET}\n`
    );
  }
}

main().catch((error: unknown) => {
  logger.error('Feedback CLI failed', {
    error: (error as Error).message,
  });
  console.error(`${RED}Fatal error: ${(error as Error).message}${RESET}`);
  process.exit(1);
});
