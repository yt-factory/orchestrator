// PIPELINE_MODE — selects how much of the 9-stage pipeline runs.
//
// "full"      runs everything (default).
// "seo_only"  skips the LLM-heavy stages that the NotebookLM-video workflow
//             doesn't need: script generation, shorts extraction, the voice
//             match in stage 6, and NotebookLM script generation.
//
// The rule is "skip the expensive LLM work, keep the cheap deterministic work":
// stage 6's visual mood/content_type (profile-derived ternaries) still run.

import { logger } from '../utils/logger';

export type PipelineMode = 'full' | 'seo_only';

export const SEO_ONLY_SKIPPED_STAGES = [
  'script_generation', // Stage 2
  'shorts_extraction', // Stage 5
  'voice_matching', // Stage 6 (matchVoice only — visual still computed)
  'notebooklm_generation', // Stage 7
] as const;

export function getPipelineMode(): PipelineMode {
  const raw = process.env.PIPELINE_MODE?.trim();
  if (!raw || raw === 'full') return 'full';
  if (raw === 'seo_only') return 'seo_only';
  logger.warn(`unknown PIPELINE_MODE="${raw}", defaulting to "full"`);
  return 'full';
}

export function isStageSkipped(stageName: string, mode: PipelineMode): boolean {
  if (mode === 'full') return false;
  return (SEO_ONLY_SKIPPED_STAGES as readonly string[]).includes(stageName);
}
