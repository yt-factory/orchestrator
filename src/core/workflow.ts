import { v4 as uuidv4 } from 'uuid';
import { writeFile, readFile, readdir, mkdir } from 'fs/promises';
import { join } from 'path';
import { ProjectManifest, ProjectManifestSchema } from './manifest';
import { logger } from '../utils/logger';

type Status = ProjectManifest['status'];

const STATE_TRANSITIONS: Record<Status, Status[]> = {
  pending: ['analyzing'],
  analyzing: ['rendering', 'failed', 'stale_recovered'],
  rendering: ['uploading', 'failed', 'stale_recovered'],
  uploading: ['completed', 'failed', 'stale_recovered'],
  completed: [],
  failed: ['pending'],
  stale_recovered: ['pending']
};

const STALE_THRESHOLDS: Partial<Record<Status, number>> = {
  analyzing: 10 * 60 * 1000,   // 10 分钟
  rendering: 30 * 60 * 1000,   // 30 分钟
  uploading: 5 * 60 * 1000     // 5 分钟
};

const HEARTBEAT_INTERVAL = 60_000; // 1 分钟
const MAX_STALE_RECOVERY_COUNT = 3; // 最大恢复次数

export class WorkflowManager {
  private heartbeatTimer: Timer | null = null;
  private projectsDir: string;
  private onProjectRecovered?: (projectId: string) => Promise<void>;

  constructor(
    projectsDir: string = './active_projects'
  ) {
    this.projectsDir = projectsDir;
  }

  /**
   * Set callback for when a stale project is recovered and needs reprocessing
   */
  setRecoveryCallback(callback: (projectId: string) => Promise<void>): void {
    this.onProjectRecovered = callback;
  }

  startHeartbeat(): void {
    this.heartbeatTimer = setInterval(
      () => this.checkStaleProjects(),
      HEARTBEAT_INTERVAL
    );
    logger.info('Heartbeat started', { intervalMs: HEARTBEAT_INTERVAL });
  }

  stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
      logger.info('Heartbeat stopped');
    }
  }

  async createProject(
    filePath: string,
    content: string,
    wordCount: number,
    readingTime: number,
    detectedLanguage?: 'en' | 'zh'
  ): Promise<string> {
    const projectId = uuidv4();
    const now = new Date().toISOString();

    const manifest: ProjectManifest = {
      project_id: projectId,
      status: 'pending',
      created_at: now,
      updated_at: now,
      input_source: {
        local_path: filePath,
        raw_content: content,
        detected_language: detectedLanguage,
        word_count: wordCount,
        estimated_reading_time_minutes: readingTime
      },
      assets: {},
      meta: {
        stale_recovery_count: 0,
        model_used: 'gemini-3-pro-preview',
        is_fallback_mode: false,
        cost: {
          total_tokens_used: 0,
          tokens_by_model: {
            'gemini-3-pro-preview': 0,
            'gemini-3-flash-preview': 0,
            'gemini-2.5-flash': 0
          },
          estimated_cost_usd: 0,
          api_calls_count: 0
        }
      }
    };

    // 创建项目目录
    const projectDir = join(this.projectsDir, projectId);
    await mkdir(projectDir, { recursive: true });

    // 保存 manifest
    await this.saveManifest(projectId, manifest);

    logger.info('Project created', { projectId, filePath, wordCount });

    return projectId;
  }

  async transitionState(projectId: string, newStatus: Status): Promise<void> {
    const manifest = await this.loadManifest(projectId);
    const currentStatus = manifest.status;

    const allowedTransitions = STATE_TRANSITIONS[currentStatus];
    if (!allowedTransitions?.includes(newStatus)) {
      throw new Error(`Invalid state transition: ${currentStatus} -> ${newStatus}`);
    }

    manifest.status = newStatus;
    manifest.updated_at = new Date().toISOString();

    await this.saveManifest(projectId, manifest);

    logger.info('State transition', { projectId, from: currentStatus, to: newStatus });
  }

  async updateManifest(
    projectId: string,
    updater: (manifest: ProjectManifest) => void
  ): Promise<ProjectManifest> {
    const manifest = await this.loadManifest(projectId);
    updater(manifest);
    manifest.updated_at = new Date().toISOString();
    await this.saveManifest(projectId, manifest);
    return manifest;
  }

  async loadManifest(projectId: string): Promise<ProjectManifest> {
    const path = join(this.projectsDir, projectId, 'manifest.json');
    const content = await readFile(path, 'utf-8');
    return ProjectManifestSchema.parse(JSON.parse(content));
  }

  private async checkStaleProjects(): Promise<void> {
    try {
      const projects = await this.getAllActiveProjects();

      for (const manifest of projects) {
        const threshold = STALE_THRESHOLDS[manifest.status];
        if (!threshold) continue;

        const staleTime = Date.now() - new Date(manifest.updated_at).getTime();
        if (staleTime > threshold) {
          await this.recoverStaleProject(manifest.project_id);
        }
      }
    } catch (error) {
      logger.error('Heartbeat check failed', { error: String(error) });
    }
  }

  private async recoverStaleProject(projectId: string): Promise<void> {
    const manifest = await this.loadManifest(projectId);

    // Check if max recovery attempts exceeded
    if (manifest.meta.stale_recovery_count >= MAX_STALE_RECOVERY_COUNT) {
      logger.error('Project exceeded max stale recovery attempts, marking as failed', {
        projectId,
        recoveryCount: manifest.meta.stale_recovery_count
      });
      manifest.status = 'failed';
      manifest.error = {
        stage: manifest.status,
        message: `Exceeded max stale recovery attempts (${MAX_STALE_RECOVERY_COUNT})`,
        retries: manifest.meta.stale_recovery_count,
        last_retry_at: new Date().toISOString()
      };
      manifest.updated_at = new Date().toISOString();
      await this.saveManifest(projectId, manifest);
      return;
    }

    logger.warn('Recovering stale project', {
      projectId,
      recoveryAttempt: manifest.meta.stale_recovery_count + 1,
      maxAttempts: MAX_STALE_RECOVERY_COUNT
    });

    manifest.status = 'stale_recovered';
    manifest.meta.stale_recovery_count += 1;
    manifest.updated_at = new Date().toISOString();

    await this.saveManifest(projectId, manifest);

    // 自动重新进入 pending
    await this.transitionState(projectId, 'pending');

    // Trigger reprocessing callback if set
    if (this.onProjectRecovered) {
      try {
        await this.onProjectRecovered(projectId);
      } catch (error) {
        logger.error('Recovery callback failed', {
          projectId,
          error: (error as Error).message
        });
      }
    }
  }

  private async saveManifest(projectId: string, manifest: ProjectManifest): Promise<void> {
    const path = join(this.projectsDir, projectId, 'manifest.json');
    await writeFile(path, JSON.stringify(manifest, null, 2));
  }

  private async getAllActiveProjects(): Promise<ProjectManifest[]> {
    const dirs = await readdir(this.projectsDir);
    const manifests: ProjectManifest[] = [];

    for (const dir of dirs) {
      try {
        const manifest = await this.loadManifest(dir);
        if (!['completed', 'failed'].includes(manifest.status)) {
          manifests.push(manifest);
        }
      } catch {
        // 忽略无效目录
      }
    }

    return manifests;
  }
}
