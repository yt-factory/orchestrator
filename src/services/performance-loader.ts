import { readFile, readdir } from 'fs/promises';
import { join } from 'path';
import { logger } from '../utils/logger';
import { ProjectManifest, ProjectManifestSchema } from '../core/manifest';
import { VideoPerformance } from './analytics-feedback';

// Statuses that indicate the project has content_engine data worth analyzing
const ANALYZABLE_STATUSES: ReadonlyArray<ProjectManifest['status']> = [
  'completed',
  'uploading',
  'pending_audio',
];

// ============================================
// Project Loading
// ============================================

/**
 * Scans the active_projects directory for manifests with analyzable status.
 * Skips subdirectories that lack a valid manifest.json.
 */
export async function loadCompletedProjects(
  projectsDir: string = './active_projects'
): Promise<ProjectManifest[]> {
  const manifests: ProjectManifest[] = [];

  let entries: string[];
  try {
    entries = await readdir(projectsDir);
  } catch (error) {
    logger.warn('Could not read projects directory', {
      projectsDir,
      error: (error as Error).message,
    });
    return manifests;
  }

  for (const entry of entries) {
    const manifestPath = join(projectsDir, entry, 'manifest.json');
    try {
      const raw = await readFile(manifestPath, 'utf-8');
      const parsed = JSON.parse(raw);
      const manifest = ProjectManifestSchema.parse(parsed);

      if (ANALYZABLE_STATUSES.includes(manifest.status)) {
        manifests.push(manifest);
      }
    } catch {
      // Skip directories without valid manifest files
    }
  }

  logger.info('Loaded completed projects for analysis', {
    scanned: entries.length,
    matched: manifests.length,
  });

  return manifests;
}

// ============================================
// Performance Extraction
// ============================================

/**
 * Extracts a VideoPerformance structure from a project manifest.
 * Returns null if the manifest lacks required data (no content_engine or no project_id).
 * Metrics are set to zero since actual YouTube analytics are not yet available.
 */
export function extractVideoPerformance(
  manifest: ProjectManifest
): VideoPerformance | null {
  if (!manifest.content_engine || !manifest.project_id) {
    return null;
  }

  const contentEngine = manifest.content_engine;

  // Use the first regional SEO title as the video title
  const firstRegion = contentEngine.seo.regional_seo[0];
  const title = firstRegion?.titles[0] ?? 'Untitled';

  // Collect emotional triggers from shorts hooks
  const emotionalTriggers: string[] = contentEngine.shorts.hooks.map(
    (hook) => hook.emotional_trigger
  );

  // Build manifest metadata; conditionally include quality_scores
  // to satisfy exactOptionalPropertyTypes (cannot assign undefined)
  const manifestData: VideoPerformance['manifest'] = {
    emotional_triggers: emotionalTriggers,
    content_type: contentEngine.media_preference.visual.content_type,
    segment_count: contentEngine.script.length,
    estimated_duration: contentEngine.estimated_duration_seconds,
  };

  if (manifest.quality_scores != null) {
    manifestData.quality_scores = manifest.quality_scores;
  }

  return {
    projectId: manifest.project_id,
    videoId: '',
    title,
    publishedAt: manifest.created_at,
    metrics: {
      views: 0,
      likes: 0,
      comments: 0,
      shares: 0,
      averageViewDuration: 0,
      averageViewPercentage: 0,
      clickThroughRate: 0,
      subscriberGained: 0,
    },
    manifest: manifestData,
  };
}

// ============================================
// Mock Metrics Generator
// ============================================

/**
 * Generates realistic mock YouTube metrics for testing purposes.
 * Used when actual analytics data is not yet available from mcp-gateway.
 */
export function generateMockMetrics(): VideoPerformance['metrics'] {
  const views = randomInt(500, 50000);
  const likeRate = randomFloat(0.02, 0.08);
  const commentRate = randomFloat(0.005, 0.03);
  const shareRate = randomFloat(0.001, 0.01);

  return {
    views,
    likes: Math.round(views * likeRate),
    comments: Math.round(views * commentRate),
    shares: Math.round(views * shareRate),
    averageViewDuration: randomInt(30, 480),
    averageViewPercentage: randomFloat(20, 75),
    clickThroughRate: randomFloat(2, 12),
    subscriberGained: randomInt(0, Math.max(1, Math.round(views * 0.005))),
  };
}

// ============================================
// Random Helpers
// ============================================

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomFloat(min: number, max: number): number {
  return Math.round((Math.random() * (max - min) + min) * 100) / 100;
}
