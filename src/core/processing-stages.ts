/**
 * Processing Stages for Progress Tracking
 *
 * This module defines the content pipeline stages and provides
 * utilities for logging progress during project processing.
 */

import { logger } from '../utils/logger';

// ============================================
// Processing Stage Definitions
// ============================================

export enum ProcessingStage {
  INIT = 'init',
  SCRIPT_GENERATION = 'script_generation',
  TREND_ANALYSIS = 'trend_analysis',
  SEO_GENERATION = 'seo_generation',
  SHORTS_EXTRACTION = 'shorts_extraction',
  VOICE_MATCHING = 'voice_matching',
  MANIFEST_UPDATE = 'manifest_update',
  FINALIZATION = 'finalization'
}

// Human-readable stage names
const STAGE_NAMES: Record<ProcessingStage, string> = {
  [ProcessingStage.INIT]: 'Initialization',
  [ProcessingStage.SCRIPT_GENERATION]: 'Script Generation',
  [ProcessingStage.TREND_ANALYSIS]: 'Trend Analysis',
  [ProcessingStage.SEO_GENERATION]: 'SEO Metadata',
  [ProcessingStage.SHORTS_EXTRACTION]: 'Shorts Extraction',
  [ProcessingStage.VOICE_MATCHING]: 'Voice Matching',
  [ProcessingStage.MANIFEST_UPDATE]: 'Manifest Update',
  [ProcessingStage.FINALIZATION]: 'Finalization'
};

// Stage order for progress calculation
const STAGE_ORDER: ProcessingStage[] = [
  ProcessingStage.INIT,
  ProcessingStage.SCRIPT_GENERATION,
  ProcessingStage.TREND_ANALYSIS,
  ProcessingStage.SEO_GENERATION,
  ProcessingStage.SHORTS_EXTRACTION,
  ProcessingStage.VOICE_MATCHING,
  ProcessingStage.MANIFEST_UPDATE,
  ProcessingStage.FINALIZATION
];

// ============================================
// State Transition Display Enhancements
// ============================================

const STATE_EMOJI: Record<string, string> = {
  pending: '⏳',
  analyzing: '📊',
  rendering: '🎬',
  uploading: '☁️',
  completed: '✅',
  failed: '❌',
  stale_recovered: '🔄',
  degraded_retry: '⚠️',
  dead_letter: '💀'
};

const STATE_PHASE_NAMES: Record<string, string> = {
  pending: 'Queued',
  analyzing: 'Content Analysis Phase',
  rendering: 'Render Queue',
  uploading: 'Upload Phase',
  completed: 'Complete',
  failed: 'Failed',
  stale_recovered: 'Stale Recovery',
  degraded_retry: 'Degraded Retry',
  dead_letter: 'Dead Letter Queue'
};

// ============================================
// Progress Tracker Class
// ============================================

export class ProgressTracker {
  private projectId: string;
  private traceId: string | undefined;
  public readonly startTime: number;
  private currentStageIndex: number = 0;
  private stageStartTime: number = 0;

  constructor(projectId: string, traceId?: string) {
    this.projectId = projectId;
    this.traceId = traceId;
    this.startTime = Date.now();
  }

  /**
   * Get elapsed time since pipeline start in milliseconds
   */
  getElapsedMs(): number {
    return Date.now() - this.startTime;
  }

  /**
   * Log the start of the pipeline
   */
  logPipelineStart(wordCount: number, language: string): void {
    logger.info('🚀 Starting content pipeline', {
      projectId: this.projectId,
      traceId: this.traceId,
      totalStages: STAGE_ORDER.length,
      wordCount,
      language
    });
  }

  /**
   * Mark the start of a processing stage
   */
  startStage(stage: ProcessingStage): void {
    this.currentStageIndex = STAGE_ORDER.indexOf(stage);
    this.stageStartTime = Date.now();

    const stepNumber = this.currentStageIndex + 1;
    const totalSteps = STAGE_ORDER.length;
    const stageName = STAGE_NAMES[stage];
    const progress = Math.round((this.currentStageIndex / totalSteps) * 100);

    logger.info(`[${stepNumber}/${totalSteps}] ${stageName} started`, {
      projectId: this.projectId,
      stage,
      progress: `${progress}%`,
      elapsedMs: Date.now() - this.startTime
    });
  }

  /**
   * Mark the completion of a processing stage
   */
  completeStage(stage: ProcessingStage, context?: Record<string, unknown>): void {
    const stepNumber = STAGE_ORDER.indexOf(stage) + 1;
    const totalSteps = STAGE_ORDER.length;
    const stageName = STAGE_NAMES[stage];
    const progress = Math.round((stepNumber / totalSteps) * 100);
    const stageDuration = Date.now() - this.stageStartTime;

    logger.info(`[${stepNumber}/${totalSteps}] ${stageName} completed`, {
      projectId: this.projectId,
      stage,
      progress: `${progress}%`,
      stageDurationMs: stageDuration,
      elapsedMs: Date.now() - this.startTime,
      ...context
    });
  }

  /**
   * Log a sub-step within a stage (e.g., generating SEO for a specific language)
   */
  logSubStep(stage: ProcessingStage, current: number, total: number, description: string): void {
    const stepNumber = STAGE_ORDER.indexOf(stage) + 1;
    const totalSteps = STAGE_ORDER.length;

    logger.debug(`[${stepNumber}/${totalSteps}] ${description} (${current}/${total})`, {
      projectId: this.projectId,
      stage,
      subStep: `${current}/${total}`
    });
  }

  /**
   * Log the completion of the entire pipeline
   */
  logPipelineComplete(context: {
    modelUsed: string;
    tokensUsed: number;
    trendCoverage: number;
    shortsCount: number;
    isDegraded: boolean;
  }): void {
    const totalDuration = Date.now() - this.startTime;

    logger.info('✅ Pipeline completed', {
      projectId: this.projectId,
      traceId: this.traceId,
      totalDurationMs: totalDuration,
      totalDurationSec: Math.round(totalDuration / 1000),
      modelUsed: context.modelUsed,
      tokensUsed: context.tokensUsed,
      trendCoverage: `${context.trendCoverage}%`,
      shortsCount: context.shortsCount,
      isDegraded: context.isDegraded
    });
  }

  /**
   * Log a pipeline error
   */
  logPipelineError(stage: ProcessingStage, error: Error): void {
    const stepNumber = STAGE_ORDER.indexOf(stage) + 1;
    const totalSteps = STAGE_ORDER.length;
    const stageName = STAGE_NAMES[stage];

    logger.error(`❌ Pipeline failed at [${stepNumber}/${totalSteps}] ${stageName}`, {
      projectId: this.projectId,
      traceId: this.traceId,
      stage,
      error: error.message,
      elapsedMs: Date.now() - this.startTime
    });
  }
}

// ============================================
// State Transition Helper
// ============================================

/**
 * Format a state transition with emoji and phase name
 */
export function formatStateTransition(from: string, to: string): string {
  const fromEmoji = STATE_EMOJI[from] ?? '❓';
  const toEmoji = STATE_EMOJI[to] ?? '❓';
  const toPhase = STATE_PHASE_NAMES[to] ?? to;

  return `${fromEmoji} ${from} → ${toEmoji} ${to} (${toPhase})`;
}

/**
 * Get the emoji for a state
 */
export function getStateEmoji(state: string): string {
  return STATE_EMOJI[state] ?? '❓';
}

/**
 * Get the phase name for a state
 */
export function getStatePhaseName(state: string): string {
  return STATE_PHASE_NAMES[state] ?? state;
}
