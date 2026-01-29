import 'dotenv/config';
import { FolderWatcher } from './core/watcher';
import { WorkflowManager } from './core/workflow';
import { GeminiClient } from './agents/gemini-client';
import { TrendsHook } from './agents/trends-hook';
import { generateMultiLangSEO } from './agents/seo-expert';
import { extractShortsHooks } from './agents/shorts-extractor';
import { matchVoice } from './agents/voice-matcher';
import { logger } from './utils/logger';
import { safeJsonParse } from './utils/json-parse';

async function main() {
  logger.info('YT-Factory Orchestrator starting...');

  // ============================================
  // Step 1: 初始化组件
  // ============================================
  const geminiClient = new GeminiClient();
  const trendsHook = new TrendsHook();
  const workflowManager = new WorkflowManager();

  // ============================================
  // Step 2: CRITICAL - Warm-up 必须在 Watcher 之前
  // ============================================
  logger.info('Warming up connections...');
  await geminiClient.warmUp();
  await trendsHook.init();  // Load trends cache from disk
  logger.info('Connection pool ready');

  // ============================================
  // Step 3: 启动 Heartbeat
  // ============================================
  // Set recovery callback to reprocess stale projects
  workflowManager.setRecoveryCallback(async (projectId) => {
    logger.info('Reprocessing recovered stale project', { projectId });
    await processProject(projectId, workflowManager, geminiClient, trendsHook);
  });
  workflowManager.startHeartbeat();
  logger.info('Heartbeat started');

  // ============================================
  // Step 4: 最后启动 Watcher
  // ============================================
  const watcher = new FolderWatcher(
    {
      incomingDir: './incoming',
      processedDir: './incoming/processed',
      stabilityDelayMs: 2000
    },
    {
      onFileReady: async (metadata) => {
        const projectId = await workflowManager.createProject(
          metadata.path,
          metadata.content,
          metadata.wordCount,
          metadata.estimatedReadingTimeMinutes,
          metadata.detectedLanguage
        );

        logger.info('Project queued for processing', {
          projectId,
          wordCount: metadata.wordCount,
          language: metadata.detectedLanguage
        });

        // 触发处理流程
        await processProject(projectId, workflowManager, geminiClient, trendsHook);
      },
      onError: (error, filePath) => {
        logger.error('Watcher error', {
          error: error.message,
          filePath
        });
      }
    }
  );

  await watcher.start();
  logger.info('Watching ./incoming for files');

  // ============================================
  // Step 5: 打印状态
  // ============================================
  logger.info('System ready', {
    availableTokens: geminiClient.getAvailableTokens(),
    establishedTrends: trendsHook.getEstablishedKeywords().length
  });

  // ============================================
  // Graceful Shutdown
  // ============================================
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, shutting down gracefully...`);

    await watcher.stop();
    workflowManager.stopHeartbeat();
    await geminiClient.drain();

    // 打印最终成本报告
    const costReport = geminiClient.getCostReport();
    logger.info('Final cost report', costReport as unknown as Record<string, unknown>);

    logger.info('Shutdown complete');
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled Rejection', {
      reason: String(reason)
    });
  });
}

// ============================================
// 项目处理流程
// ============================================

async function processProject(
  projectId: string,
  workflowManager: WorkflowManager,
  geminiClient: GeminiClient,
  trendsHook: TrendsHook
): Promise<void> {
  const startTime = Date.now();
  const startTokens = geminiClient.getTokenSnapshot();

  try {
    // pending -> analyzing
    await workflowManager.transitionState(projectId, 'analyzing');
    const manifest = await workflowManager.loadManifest(projectId);
    const rawContent = manifest.input_source.raw_content;

    // 生成脚本
    const scriptResult = await geminiClient.generate(
      `You are a professional YouTube scriptwriter. Convert this content into a video script with timestamps.

Each segment must have:
- timestamp: "MM:SS" format
- voiceover: the narration text
- visual_hint: one of code_block, diagram, text_animation, b-roll, screen_recording, talking_head_placeholder
- estimated_duration_seconds: positive number

Output as JSON: { "script": [...], "estimated_duration_seconds": number }

Content:
${rawContent}`,
      { projectId, priority: 'high' }
    );
    const scriptData = safeJsonParse<{
      script: Array<{
        timestamp: string;
        voiceover: string;
        visual_hint: 'code_block' | 'diagram' | 'text_animation' | 'b-roll' | 'screen_recording' | 'talking_head_placeholder';
        estimated_duration_seconds: number;
      }>;
      estimated_duration_seconds: number;
    }>(scriptResult.text, { projectId, operation: 'scriptGeneration' });
    const script = scriptData.script ?? [];
    const estimated_duration_seconds = scriptData.estimated_duration_seconds ?? 60;

    // 生成 SEO
    const seoData = await generateMultiLangSEO(rawContent, projectId, geminiClient, trendsHook);

    // 提取 Shorts
    const shortsData = await extractShortsHooks(script, projectId, geminiClient);

    // Calculate tokens used for this project
    const endTokens = geminiClient.getTokenSnapshot();
    const projectTokensUsed = endTokens - startTokens;
    const globalCost = geminiClient.getCostReport();

    // 更新 manifest
    await workflowManager.updateManifest(projectId, (m) => {
      const mood = 'professional' as const;
      const contentType = 'tutorial' as const;
      const language = manifest.input_source.detected_language ?? 'en';
      const voice = matchVoice(mood, contentType, language);

      m.content_engine = {
        script,
        seo: seoData,
        shorts: shortsData,
        estimated_duration_seconds,
        media_preference: {
          visual: { mood, content_type: contentType },
          voice
        }
      };
      m.meta.processing_time_ms = Date.now() - startTime;
      m.meta.model_used = scriptResult.modelUsed;
      m.meta.is_fallback_mode = scriptResult.isFallbackMode;

      // Update per-project cost tracking
      m.meta.cost.total_tokens_used = projectTokensUsed;
      m.meta.cost.api_calls_count = globalCost.api_calls_count - (manifest.meta.cost?.api_calls_count ?? 0);
      // Estimate cost based on primary model used
      const pricePerMillion = scriptResult.modelUsed.includes('pro') ? 5.0 :
                              scriptResult.modelUsed.includes('flash') ? 0.5 : 0.15;
      m.meta.cost.estimated_cost_usd = (projectTokensUsed / 1_000_000) * pricePerMillion;
    });

    // analyzing -> rendering
    await workflowManager.transitionState(projectId, 'rendering');

    logger.info('Project analysis complete', {
      projectId,
      processingTimeMs: Date.now() - startTime,
      modelUsed: scriptResult.modelUsed,
      trendCoverage: seoData.trend_coverage_score,
      shortsCount: shortsData.hooks.length
    });
  } catch (error) {
    logger.error('Project processing failed', {
      projectId,
      error: (error as Error).message,
      stage: 'analyzing'
    });

    try {
      await workflowManager.updateManifest(projectId, (m) => {
        m.status = 'failed';
        m.error = {
          stage: 'analyzing',
          message: (error as Error).message,
          retries: 3,
          last_retry_at: new Date().toISOString()
        };
      });
    } catch {
      logger.error('Failed to update manifest on error', { projectId });
    }
  }
}

main().catch((error) => {
  logger.error('Fatal error during startup', { error: error.message });
  process.exit(1);
});
