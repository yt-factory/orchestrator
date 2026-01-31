import { v4 as uuidv4 } from 'uuid';
import { writeFile, readFile, readdir, mkdir, rename, appendFile } from 'fs/promises';
import { join } from 'path';
import { ProjectManifest, ProjectManifestSchema, ErrorFingerprint, type NotebookLMAudioConfig } from './manifest';
import { logger } from '../utils/logger';
import { modelDegradation, type ModelConfig } from '../services/model-degradation';
import { fileHashManager } from './file-hash-manager';
import { formatStateTransition } from './processing-stages';
import { checkAndUpdateAudioStatus } from '../agents/notebooklm-generator';

type Status = ProjectManifest['status'];

const STATE_TRANSITIONS: Record<Status, Status[]> = {
  pending: ['analyzing'],
  analyzing: ['pending_audio', 'rendering', 'failed', 'stale_recovered', 'degraded_retry', 'dead_letter'],
  pending_audio: ['rendering', 'failed', 'stale_recovered', 'dead_letter'],
  rendering: ['uploading', 'failed', 'stale_recovered', 'dead_letter'],
  uploading: ['completed', 'failed', 'stale_recovered', 'dead_letter'],
  completed: [],
  failed: ['pending', 'dead_letter'],
  stale_recovered: ['pending'],
  degraded_retry: ['analyzing', 'failed', 'dead_letter'],
  dead_letter: []  // Terminal state
};

const STALE_THRESHOLDS: Partial<Record<Status, number>> = {
  analyzing: 10 * 60 * 1000,   // 10 分钟
  rendering: 30 * 60 * 1000,   // 30 分钟
  uploading: 5 * 60 * 1000,    // 5 分钟
  degraded_retry: 15 * 60 * 1000  // 15 分钟
};

const HEARTBEAT_INTERVAL = 60_000; // 1 分钟
const MAX_STALE_RECOVERY_COUNT = 3; // 最大恢复次数
const MAX_RETRIES = 3; // 最大重试次数
const DEAD_LETTER_DIR = './dead-letter';
const ALERTS_DIR = './logs/alerts';

// Alert interface
interface Alert {
  type: 'dead_letter' | 'error' | 'warning';
  severity: 'critical' | 'high' | 'medium' | 'low';
  projectId: string;
  traceId: string | undefined;
  reason: string;
  errorFingerprint: ErrorFingerprint | undefined;
  retryCount: number | undefined;
  usedModels: string[] | undefined;
  timestamp: string;
}

export class WorkflowManager {
  private heartbeatTimer: Timer | null = null;
  private projectsDir: string;
  private onProjectRecovered?: (projectId: string) => Promise<void>;
  private onAudioReady?: (projectId: string, audioConfig: NotebookLMAudioConfig) => Promise<void>;

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

  /**
   * Set callback for when audio files are detected in a pending_audio project
   */
  setAudioReadyCallback(callback: (projectId: string, audioConfig: NotebookLMAudioConfig) => Promise<void>): void {
    this.onAudioReady = callback;
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
    const traceId = uuidv4();
    const now = new Date().toISOString();

    // Get file hash for duplicate detection
    let fileHash: string | undefined;
    let fileSize: number | undefined;
    try {
      const hashInfo = await fileHashManager.getFileHash(filePath);
      fileHash = hashInfo.hash;
      fileSize = hashInfo.size;
    } catch {
      logger.warn('Could not calculate file hash', { filePath });
    }

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
        },
        retry_count: 0,
        error_history: [],
        used_models: [],
        is_degraded: false,
        is_dead_letter: false,
        trace_id: traceId,
        file_hash: fileHash,
        file_size: fileSize
      }
    };

    // 创建项目目录
    const projectDir = join(this.projectsDir, projectId);
    await mkdir(projectDir, { recursive: true });

    // 保存 manifest
    await this.saveManifest(projectId, manifest);

    logger.info('Project created', { projectId, traceId, filePath, wordCount });

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

    // Enhanced state transition logging with emoji and phase name
    const transitionMsg = formatStateTransition(currentStatus, newStatus);
    logger.info(`State: ${transitionMsg}`, {
      projectId,
      from: currentStatus,
      to: newStatus,
      traceId: manifest.meta.trace_id
    });
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

  /**
   * Handle an error during project processing with intelligent degradation
   */
  async handleError(projectId: string, error: Error, stage: string): Promise<void> {
    const manifest = await this.loadManifest(projectId);
    const traceId = manifest.meta.trace_id;

    // Parse error fingerprint
    const fingerprint = modelDegradation.parseErrorFingerprint(error);

    // Record error in history
    manifest.meta.error_history = manifest.meta.error_history || [];
    manifest.meta.error_history.push({
      timestamp: new Date().toISOString(),
      error: error.message,
      fingerprint,
      stage,
      model: manifest.meta.current_model ?? manifest.meta.model_used
    });

    manifest.meta.error_fingerprint = fingerprint;
    manifest.error = {
      stage,
      message: error.message,
      retries: manifest.meta.retry_count ?? 0,
      last_retry_at: new Date().toISOString(),
      fallback_model_used: manifest.meta.current_model
    };

    logger.error('Project processing failed', {
      projectId,
      traceId,
      error: error.message,
      fingerprint,
      retryCount: manifest.meta.retry_count,
      currentModel: manifest.meta.current_model,
      stage
    });

    // Check if we should attempt degraded retry
    if (modelDegradation.shouldDegrade(fingerprint, manifest)) {
      await this.saveManifest(projectId, manifest);
      await this.attemptDegradedRetry(projectId);
      return;
    }

    // Normal retry logic
    manifest.meta.retry_count = (manifest.meta.retry_count ?? 0) + 1;

    if (manifest.meta.retry_count >= MAX_RETRIES) {
      await this.saveManifest(projectId, manifest);
      await this.moveToDeadLetter(projectId, `Max retries (${MAX_RETRIES}) exceeded: ${error.message}`);
    } else {
      manifest.status = 'failed';
      await this.saveManifest(projectId, manifest);
    }
  }

  /**
   * Attempt a degraded retry with a different model
   */
  async attemptDegradedRetry(projectId: string): Promise<void> {
    const manifest = await this.loadManifest(projectId);
    const traceId = manifest.meta.trace_id;

    const nextModel = modelDegradation.getNextModel(manifest);

    if (!nextModel) {
      // No more models available, move to dead letter
      await this.moveToDeadLetter(projectId, 'All models exhausted during degradation');
      return;
    }

    logger.warn('Attempting degraded retry', {
      projectId,
      traceId,
      previousModel: manifest.meta.current_model ?? manifest.meta.model_used,
      nextModel: nextModel.name,
      strictness: nextModel.strictness
    });

    // Mark current model as used
    const currentModel = manifest.meta.current_model ?? manifest.meta.model_used;
    manifest.meta.used_models = manifest.meta.used_models || [];
    if (currentModel && !manifest.meta.used_models.includes(currentModel)) {
      manifest.meta.used_models.push(currentModel);
    }

    // Switch to degraded model
    manifest.meta.current_model = nextModel.name;
    manifest.meta.model_used = nextModel.name;
    manifest.meta.is_degraded = nextModel.strictness === 'strict';
    manifest.meta.is_fallback_mode = true;
    manifest.status = 'degraded_retry';

    await this.saveManifest(projectId, manifest);

    // Trigger reprocessing via callback
    if (this.onProjectRecovered) {
      try {
        // Transition to pending first to allow normal processing
        await this.transitionState(projectId, 'analyzing');
        await this.onProjectRecovered(projectId);
      } catch (err) {
        logger.error('Degraded retry callback failed', {
          projectId,
          error: (err as Error).message
        });
      }
    }
  }

  /**
   * Move project to dead letter queue
   */
  async moveToDeadLetter(projectId: string, reason: string): Promise<void> {
    const manifest = await this.loadManifest(projectId);
    const traceId = manifest.meta.trace_id;

    logger.error('Project moved to dead letter queue', {
      projectId,
      traceId,
      reason,
      retryCount: manifest.meta.retry_count,
      usedModels: manifest.meta.used_models,
      errorHistoryCount: manifest.meta.error_history?.length ?? 0
    });

    manifest.status = 'dead_letter';
    manifest.meta.is_dead_letter = true;

    await this.saveManifest(projectId, manifest);

    // Create dead letter directories
    await mkdir(DEAD_LETTER_DIR, { recursive: true });
    await mkdir(ALERTS_DIR, { recursive: true });

    // Move source file to dead letter directory
    const deadLetterPath = join(
      DEAD_LETTER_DIR,
      `${projectId}_${Date.now()}.json`
    );

    // Save complete error report
    const errorReport = {
      projectId,
      traceId,
      reason,
      manifest,
      movedAt: new Date().toISOString()
    };

    await writeFile(deadLetterPath, JSON.stringify(errorReport, null, 2));

    // Send alert
    await this.sendAlert({
      type: 'dead_letter',
      severity: 'critical',
      projectId,
      traceId,
      reason,
      errorFingerprint: manifest.meta.error_fingerprint,
      retryCount: manifest.meta.retry_count,
      usedModels: manifest.meta.used_models,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Send an alert for critical issues
   */
  private async sendAlert(alert: Alert): Promise<void> {
    try {
      // Ensure alerts directory exists
      await mkdir(ALERTS_DIR, { recursive: true });

      // Write individual alert file
      const alertFile = join(ALERTS_DIR, `${alert.projectId}_${Date.now()}.json`);
      await writeFile(alertFile, JSON.stringify(alert, null, 2));

      // Append to aggregated alerts log
      await appendFile(
        './logs/alerts.log',
        JSON.stringify(alert) + '\n'
      );

      logger.warn('ALERT: Dead letter queue entry', alert as unknown as Record<string, unknown>);

      // TODO: Integrate with external alerting (Slack, Discord, PagerDuty, etc.)
    } catch (error) {
      logger.error('Failed to send alert', {
        projectId: alert.projectId,
        error: (error as Error).message
      });
    }
  }

  /**
   * Get the current model configuration for a project
   */
  getModelConfig(manifest: ProjectManifest): ModelConfig {
    const modelName = manifest.meta.current_model ?? manifest.meta.model_used;
    const allModels = modelDegradation.getAllModels();
    return allModels.find(m => m.name === modelName) ?? modelDegradation.getDefaultModel();
  }

  /**
   * Check if a file has already been processed
   */
  async isFileAlreadyProcessed(filePath: string): Promise<{
    isProcessed: boolean;
    existingProjectId: string | undefined;
  }> {
    const result = await fileHashManager.isAlreadyProcessed(filePath);
    return {
      isProcessed: result.isProcessed,
      existingProjectId: result.existingProject?.projectId
    };
  }

  /**
   * Mark a file as processed after successful completion
   */
  async markFileAsProcessed(projectId: string): Promise<void> {
    const manifest = await this.loadManifest(projectId);
    const fileHash = manifest.meta.file_hash;
    const filePath = manifest.input_source.local_path;

    if (fileHash) {
      await fileHashManager.markAsProcessed(filePath, fileHash, projectId);
    }
  }

  private async checkStaleProjects(): Promise<void> {
    try {
      const projects = await this.getAllActiveProjects();

      for (const manifest of projects) {
        // Check for audio files in pending_audio projects
        if (manifest.status === 'pending_audio') {
          await this.checkPendingAudioProject(manifest.project_id);
          continue;
        }

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

  /**
   * Check if audio files are ready for a pending_audio project
   */
  private async checkPendingAudioProject(projectId: string): Promise<void> {
    try {
      const manifest = await this.loadManifest(projectId);

      if (!manifest.audio) {
        logger.warn('No audio config found for pending_audio project', { projectId });
        return;
      }

      const projectDir = join(this.projectsDir, projectId);
      const updatedAudioConfig = await checkAndUpdateAudioStatus(projectDir, manifest.audio);

      // Check if any audio files were detected
      const hasNewAudio = Object.entries(updatedAudioConfig.languages).some(([lang, config]) => {
        const originalConfig = manifest.audio?.languages[lang as 'en' | 'zh'];
        return config?.audio_status === 'ready' && originalConfig?.audio_status === 'pending';
      });

      if (hasNewAudio) {
        // Update manifest with new audio status
        await this.updateManifest(projectId, (m) => {
          m.audio = updatedAudioConfig;
        });

        // Check if all required audio files are ready
        const configuredLanguages = Object.entries(updatedAudioConfig.languages)
          .filter((entry): entry is [string, NonNullable<typeof entry[1]>] => entry[1] !== undefined);
        const allAudioReady = configuredLanguages.length > 0 &&
          configuredLanguages.every(([, config]) => config.audio_status === 'ready');

        if (allAudioReady) {
          logger.info('All audio files ready for project', {
            projectId,
            languages: Object.keys(updatedAudioConfig.languages)
          });

          // Trigger callback if set
          if (this.onAudioReady) {
            await this.onAudioReady(projectId, updatedAudioConfig);
          }

          // Print instructions for video rendering
          this.printRenderInstructions(projectId, projectDir, updatedAudioConfig);
        } else {
          // Some audio detected but not all
          const readyLanguages = Object.entries(updatedAudioConfig.languages)
            .filter(([, config]) => config?.audio_status === 'ready')
            .map(([lang]) => lang);
          const pendingLanguages = Object.entries(updatedAudioConfig.languages)
            .filter(([, config]) => config?.audio_status === 'pending')
            .map(([lang]) => lang);

          logger.info('Partial audio detected', {
            projectId,
            ready: readyLanguages,
            pending: pendingLanguages
          });
        }
      }
    } catch (error) {
      logger.error('Failed to check audio status', {
        projectId,
        error: (error as Error).message
      });
    }
  }

  /**
   * Print instructions for video rendering when audio is ready
   */
  private printRenderInstructions(projectId: string, projectDir: string, audioConfig: NotebookLMAudioConfig): void {
    console.log('');
    console.log('═'.repeat(70));
    console.log('🎧 Audio files detected! Ready for video rendering.');
    console.log('═'.repeat(70));
    console.log('');
    console.log(`📁 Project: ${projectId}`);
    console.log('');

    for (const [lang, config] of Object.entries(audioConfig.languages)) {
      if (config?.audio_status === 'ready') {
        const durationStr = config.duration_seconds
          ? `${Math.floor(config.duration_seconds / 60)}:${String(Math.floor(config.duration_seconds % 60)).padStart(2, '0')}`
          : 'unknown';
        console.log(`  [${lang.toUpperCase()}] Audio ready (${durationStr})`);
        console.log(`     Path: ${projectDir}/${config.audio_path}`);
      }
    }

    console.log('');
    console.log('  【Next Steps / 下一步】');
    console.log('  Run the video renderer:');
    for (const lang of Object.keys(audioConfig.languages)) {
      console.log(`    node video-renderer/render.mjs ${projectId} --lang=${lang}`);
    }
    console.log('');
    console.log('═'.repeat(70));
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
