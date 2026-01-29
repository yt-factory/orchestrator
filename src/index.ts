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
import { fileHashManager } from './core/file-hash-manager';
import { modelDegradation } from './services/model-degradation';
import { ProgressTracker, ProcessingStage } from './core/processing-stages';

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
  await fileHashManager.init();  // Load file hash cache from disk
  logger.info('Connection pool ready', {
    hashCacheStats: fileHashManager.getStats()
  });

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
      processedDir: './processed',  // Outside incoming to prevent duplicate detection
      stabilityDelayMs: 2000
    },
    {
      onFileReady: async (metadata) => {
        // Check for duplicate files before processing
        const duplicateCheck = await workflowManager.isFileAlreadyProcessed(metadata.path);

        if (duplicateCheck.isProcessed) {
          logger.info('File already processed, skipping', {
            filePath: metadata.path,
            existingProjectId: duplicateCheck.existingProjectId
          });
          return;
        }

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
  const startTokens = geminiClient.getTokenSnapshot();

  // Load manifest first to get traceId for progress tracker
  const manifest = await workflowManager.loadManifest(projectId);
  const traceId = manifest.meta.trace_id;
  const rawContent = manifest.input_source.raw_content;
  const wordCount = manifest.input_source.word_count;
  const language = manifest.input_source.detected_language ?? 'en';

  // Initialize progress tracker
  const progress = new ProgressTracker(projectId, traceId);
  progress.logPipelineStart(wordCount, language);

  try {
    // ============================================
    // Stage 1: Initialization
    // ============================================
    progress.startStage(ProcessingStage.INIT);

    // pending -> analyzing
    await workflowManager.transitionState(projectId, 'analyzing');

    // Get current model config for potential degraded prompt
    const modelConfig = workflowManager.getModelConfig(manifest);

    progress.completeStage(ProcessingStage.INIT, {
      model: modelConfig.name,
      isDegraded: manifest.meta.is_degraded
    });

    // ============================================
    // Stage 2: Script Generation
    // ============================================
    progress.startStage(ProcessingStage.SCRIPT_GENERATION);

    // Build script generation prompt
    let scriptPrompt = `You are a professional YouTube scriptwriter. Convert this content into a video script with timestamps.

Each segment must have:
- timestamp: "MM:SS" format
- voiceover: the narration text
- visual_hint: one of code_block, diagram, text_animation, b-roll, screen_recording, talking_head_placeholder
- estimated_duration_seconds: positive number

Output as JSON: { "script": [...], "estimated_duration_seconds": number }

Content:
${rawContent}`;

    // Apply degraded prompt if using strict model
    scriptPrompt = modelDegradation.getDegradedPrompt(scriptPrompt, modelConfig);

    // 生成脚本
    const scriptResult = await geminiClient.generate(scriptPrompt, {
      projectId,
      priority: 'high',
      preferredModel: modelConfig.name
    });
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

    progress.completeStage(ProcessingStage.SCRIPT_GENERATION, {
      segmentCount: script.length,
      durationSec: estimated_duration_seconds,
      tokensUsed: scriptResult.tokensUsed,
      model: scriptResult.modelUsed
    });

    // ============================================
    // Stage 3-4: Trend Analysis + SEO Generation
    // ============================================
    progress.startStage(ProcessingStage.TREND_ANALYSIS);
    // Note: generateMultiLangSEO internally handles both trend analysis and SEO generation
    const seoData = await generateMultiLangSEO(rawContent, projectId, geminiClient, trendsHook);
    progress.completeStage(ProcessingStage.SEO_GENERATION, {
      trendCoverage: seoData.trend_coverage_score,
      faqCount: seoData.faq_structured_data.length,
      regionalSeoCount: seoData.regional_seo.length
    });

    // ============================================
    // Stage 5: Shorts Extraction
    // ============================================
    progress.startStage(ProcessingStage.SHORTS_EXTRACTION);
    const shortsData = await extractShortsHooks(script, projectId, geminiClient);
    progress.completeStage(ProcessingStage.SHORTS_EXTRACTION, {
      hooksCount: shortsData.hooks.length,
      topEmotion: shortsData.hooks[0]?.emotional_trigger,
      cropFocus: shortsData.vertical_crop_focus
    });

    // ============================================
    // Stage 6: Voice Matching
    // ============================================
    progress.startStage(ProcessingStage.VOICE_MATCHING);
    const mood = 'professional' as const;
    const contentType = 'tutorial' as const;
    const voice = matchVoice(mood, contentType, language);
    progress.completeStage(ProcessingStage.VOICE_MATCHING, {
      provider: voice?.provider,
      style: voice?.style
    });

    // ============================================
    // Stage 7: Manifest Update
    // ============================================
    progress.startStage(ProcessingStage.MANIFEST_UPDATE);

    // Calculate tokens used for this project
    const endTokens = geminiClient.getTokenSnapshot();
    const projectTokensUsed = endTokens - startTokens;
    const globalCost = geminiClient.getCostReport();
    const pipelineElapsedMs = progress.getElapsedMs();

    // 更新 manifest
    await workflowManager.updateManifest(projectId, (m) => {
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
      m.meta.processing_time_ms = pipelineElapsedMs;
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

    progress.completeStage(ProcessingStage.MANIFEST_UPDATE, {
      tokensUsed: projectTokensUsed,
      estimatedCostUsd: (projectTokensUsed / 1_000_000) * (scriptResult.modelUsed.includes('pro') ? 5.0 : 0.5)
    });

    // ============================================
    // Stage 8: Finalization
    // ============================================
    progress.startStage(ProcessingStage.FINALIZATION);

    // analyzing -> rendering
    await workflowManager.transitionState(projectId, 'rendering');

    // Mark file as processed for duplicate detection
    await workflowManager.markFileAsProcessed(projectId);

    progress.completeStage(ProcessingStage.FINALIZATION);

    // Log pipeline completion summary
    progress.logPipelineComplete({
      modelUsed: scriptResult.modelUsed,
      tokensUsed: projectTokensUsed,
      trendCoverage: seoData.trend_coverage_score,
      shortsCount: shortsData.hooks.length,
      isDegraded: manifest.meta.is_degraded
    });

  } catch (error) {
    // Log pipeline error with stage context
    progress.logPipelineError(ProcessingStage.SCRIPT_GENERATION, error as Error);
    // Use new intelligent error handling with degradation support
    await workflowManager.handleError(projectId, error as Error, 'analyzing');
  }
}

main().catch((error) => {
  logger.error('Fatal error during startup', { error: error.message });
  process.exit(1);
});
