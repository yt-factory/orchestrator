import 'dotenv/config';
import { join, basename } from 'path';
import { FolderWatcher } from './core/watcher';
import { WorkflowManager } from './core/workflow';
import { getNotebookLMGeminiClient, type NotebookLMGeminiClient } from './agents/notebooklm-gemini-client';
import { TrendsHook } from './agents/trends-hook';
import { generateMultiLangSEO } from './agents/seo-expert';
import { extractShortsHooks } from './agents/shorts-extractor';
import { matchVoice } from './agents/voice-matcher';
import { generateNotebookLMScripts, buildAudioConfig, printNextSteps, checkAndUpdateAudioStatus, type GeneratedScript } from './agents/notebooklm-generator';
import { logger } from './utils/logger';
import { normalizeScriptSegments } from './utils/json-parse';
import { fileHashManager } from './core/file-hash-manager';
import { modelDegradation } from './services/model-degradation';
import { ProgressTracker, ProcessingStage } from './core/processing-stages';
import { ChannelProfileManager } from './core/channel-profile';
import { buildScriptPrompt } from './prompts/script-prompt-builder';
import { generateWithSelfScoring, stripQualityMeta } from './prompts/self-scoring';
import { parseKoan } from './parsers/koan';
import { getPipelineMode, isStageSkipped, SEO_ONLY_SKIPPED_STAGES } from './config/pipeline-mode';
import { skippedShorts, skippedVoice, skippedAudio } from './pipeline/skip-stage-helpers';
import type { ScriptSegment, ShortsExtraction, VoicePersona, NotebookLMAudioConfig } from './core/manifest';
import { getProvider, type BaseLLMProvider } from './llm/providers';
import { CostTracker } from './llm/base/cost-tracker';

const onceMode = process.argv.includes('--once');

// Force-bypass the LLM cache via either the --no-cache flag or the
// FORCE_NO_LLM_CACHE env (set by `bun run process:force` / `make process FORCE=1`).
// Normalized to LLM_NO_CACHE so the provider reads a single source.
if (
  process.argv.includes('--no-cache') ||
  process.env.FORCE_NO_LLM_CACHE === '1' ||
  process.env.FORCE_NO_LLM_CACHE === 'true'
) {
  process.env.LLM_NO_CACHE = 'true';
}

async function main() {
  logger.info('YT-Factory Orchestrator starting...', { onceMode });

  const pipelineMode = getPipelineMode();
  logger.info(`Pipeline mode: ${pipelineMode}`, {
    skippedStages: pipelineMode === 'seo_only' ? [...SEO_ONLY_SKIPPED_STAGES] : [],
  });

  // ============================================
  // Step 1: 初始化组件
  // ============================================
  // Shared cost tracker: the pipeline provider and the NotebookLM Gemini client
  // both record into it, so processProject reads one per-project cost snapshot.
  const sharedCostTracker = new CostTracker();
  const provider = getProvider(undefined, { costTracker: sharedCostTracker });
  // NotebookLM keeps the legacy direct-Gemini path (not tier-routed, not DeepSeek).
  const notebooklmClient = getNotebookLMGeminiClient({ costTracker: sharedCostTracker });
  const trendsHook = new TrendsHook();
  const workflowManager = new WorkflowManager();

  // Track in-flight projects for --once mode
  const pendingProjects = new Set<string>();
  let allFilesDetected = false;

  // ============================================
  // Step 2: CRITICAL - Warm-up 必须在 Watcher 之前
  // ============================================
  logger.info('Warming up connections...');
  await provider.warmUp();
  await notebooklmClient.warmUp();
  await trendsHook.init();  // Load trends cache from disk
  await fileHashManager.init();  // Load file hash cache from disk
  logger.info('Connection pool ready', {
    hashCacheStats: fileHashManager.getStats()
  });

  // ============================================
  // Step 3: 启动 Heartbeat
  // ============================================
  // Set recovery callback to reprocess stale projects (skip in --once mode)
  if (!onceMode) {
    workflowManager.setRecoveryCallback(async (projectId) => {
      logger.info('Reprocessing recovered stale project', { projectId });
      await processProject(projectId, workflowManager, provider, trendsHook, notebooklmClient);
    });
    workflowManager.startHeartbeat();
    logger.info('Heartbeat started');
  }

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

        // Track for --once mode
        pendingProjects.add(projectId);

        // 触发处理流程
        await processProject(projectId, workflowManager, provider, trendsHook, notebooklmClient);

        // Auto-exit in --once mode when all projects done
        pendingProjects.delete(projectId);
        if (onceMode && allFilesDetected && pendingProjects.size === 0) {
          logger.info('All files processed, exiting (--once mode)');
          await watcher.stop();
          await provider.drain();
          await notebooklmClient.drain();
          process.exit(0);
        }
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

  // In --once mode, mark initial scan complete after a short delay
  // (chokidar fires all 'add' events synchronously during start)
  if (onceMode) {
    setTimeout(async () => {
      allFilesDetected = true;
      if (pendingProjects.size === 0) {
        logger.info('No files found in incoming, exiting (--once mode)');
        await watcher.stop();
        await provider.drain();
        await notebooklmClient.drain();
        process.exit(0);
      }
    }, 3000);
  }

  // ============================================
  // Step 5: 打印状态
  // ============================================
  logger.info('System ready', {
    availableTokens: provider.getAvailableTokens(),
    establishedTrends: trendsHook.getEstablishedKeywords().length
  });

  // ============================================
  // Graceful Shutdown
  // ============================================
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, shutting down gracefully...`);

    await watcher.stop();
    workflowManager.stopHeartbeat();
    await provider.drain();
    await notebooklmClient.drain();

    // 打印最终成本报告 (shared tracker: includes NotebookLM cost)
    const costReport = provider.getCostReport();
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
  provider: BaseLLMProvider,
  trendsHook: TrendsHook,
  notebooklmClient: NotebookLMGeminiClient,
): Promise<void> {
  // Shared cost tracker, so this snapshot spans provider + NotebookLM calls.
  const startTokens = provider.getTokenSnapshot();
  const startLlm = provider.getRunStats();

  // Load manifest first to get traceId for progress tracker
  const manifest = await workflowManager.loadManifest(projectId);
  const traceId = manifest.meta.trace_id;
  const rawContent = manifest.input_source.raw_content;
  const wordCount = manifest.input_source.word_count;
  const language = manifest.input_source.detected_language ?? 'en';

  // Parse koan metadata (Phase 5). Pre-format-v2 koans (legacy ep04-20, etc.)
  // lack structured metadata and are skipped — not reprocessed.
  const sourceFile = basename(manifest.input_source.local_path);
  const parsed = parseKoan(rawContent, sourceFile);
  if (!parsed.ok) {
    logger.warn(`skipping pre-format-v2 koan: ${sourceFile} (${parsed.reason})`, { projectId });
    await workflowManager.markFileAsProcessed(projectId).catch(() => {});
    return;
  }
  const koan = parsed.koan;

  // Load channel profile for this project
  const channelProfileManager = new ChannelProfileManager();
  const channelProfile = await channelProfileManager.loadForProject(projectId);

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
    // PIPELINE_MODE (full vs seo_only). Skipped stages still write their manifest
    // fields as empty values (D1) so downstream consumers never null-pointer.
    const pipelineMode = getPipelineMode();

    // Stage outputs, with skip-safe defaults; assigned below when the stage runs.
    let script: ScriptSegment[] = [];
    let estimated_duration_seconds = 0;
    let scriptConfidence = channelProfile.quality.min_confidence_score;
    let shortsData: ShortsExtraction = skippedShorts();
    let voice: VoicePersona = skippedVoice();
    let notebookLMScripts: GeneratedScript[] = [];
    let audioConfig: NotebookLMAudioConfig = skippedAudio();
    const projectDir = join('./active_projects', projectId);

    progress.startStage(ProcessingStage.SCRIPT_GENERATION);
    if (isStageSkipped('script_generation', pipelineMode)) {
      logger.info(`[2/9] Script Generation SKIPPED (PIPELINE_MODE=${pipelineMode})`, {
        projectId, stage: 'script_generation', skipped: true,
      });
      progress.completeStage(ProcessingStage.SCRIPT_GENERATION, { skipped: true });
    } else {
      // Build rich script prompt from channel profile
      const scriptPrompt = buildScriptPrompt(rawContent, channelProfile, language);

      // Generate script with self-scoring for quality assurance
      const scriptScoredResult = await generateWithSelfScoring<{
        script: Array<{
          timestamp: string;
          voiceover: string;
          visual_hint: string;
          estimated_duration_seconds: number;
        }>;
        estimated_duration_seconds: number;
      }>(
        provider,
        modelDegradation.getDegradedPrompt(scriptPrompt, modelConfig),
        // tier: smart — core creative script generation.
        { tier: 'smart', projectId, priority: 'high' },
        channelProfile.quality.min_confidence_score
      );
      const scriptDataRaw = stripQualityMeta(scriptScoredResult.data);

      // Normalize visual_hint values (Gemini sometimes generates 'b_roll' instead of 'b-roll')
      const scriptData = {
        ...scriptDataRaw,
        script: normalizeScriptSegments(scriptDataRaw.script ?? []) as Array<{
          timestamp: string;
          voiceover: string;
          visual_hint: 'code_block' | 'diagram' | 'text_animation' | 'b-roll' | 'screen_recording' | 'talking_head_placeholder';
          estimated_duration_seconds: number;
        }>
      };
      script = scriptData.script ?? [];
      estimated_duration_seconds = scriptData.estimated_duration_seconds ?? 60;
      scriptConfidence = scriptScoredResult.confidence;

      progress.completeStage(ProcessingStage.SCRIPT_GENERATION, {
        segmentCount: script.length,
        durationSec: estimated_duration_seconds,
        scriptConfidence,
      });
    }

    // ============================================
    // Stage 3-4: Trend Analysis + SEO Generation (always runs)
    // ============================================
    progress.startStage(ProcessingStage.TREND_ANALYSIS);
    // Note: generateMultiLangSEO internally handles both trend analysis and SEO generation
    const seoData = await generateMultiLangSEO(rawContent, projectId, provider, trendsHook, channelProfile, koan);
    progress.completeStage(ProcessingStage.SEO_GENERATION, {
      trendCoverage: seoData.trend_coverage_score,
      faqCount: seoData.regional_seo.reduce((n, r) => n + r.faq.length, 0),
      regionalSeoCount: seoData.regional_seo.length
    });

    // ============================================
    // Stage 5: Shorts Extraction
    // ============================================
    progress.startStage(ProcessingStage.SHORTS_EXTRACTION);
    if (isStageSkipped('shorts_extraction', pipelineMode)) {
      logger.info(`[5/9] Shorts Extraction SKIPPED (PIPELINE_MODE=${pipelineMode})`, {
        projectId, stage: 'shorts_extraction', skipped: true,
      });
      progress.completeStage(ProcessingStage.SHORTS_EXTRACTION, { skipped: true });
    } else {
      shortsData = await extractShortsHooks(script, projectId, provider);
      progress.completeStage(ProcessingStage.SHORTS_EXTRACTION, {
        hooksCount: shortsData.hooks.length,
        topEmotion: shortsData.hooks[0]?.emotional_trigger,
        cropFocus: shortsData.vertical_crop_focus
      });
    }

    // ============================================
    // Stage 6: Voice Matching. Visual mood/content_type are cheap, profile-derived,
    // and consumed downstream by media planning — always computed. Only the
    // matchVoice LLM-adjacent lookup is skippable.
    // ============================================
    progress.startStage(ProcessingStage.VOICE_MATCHING);
    const mood = (channelProfile.voice.tone[0] === 'energetic' ? 'energetic'
      : channelProfile.voice.tone[0] === 'calm' ? 'calm'
      : channelProfile.voice.tone.includes('casual') ? 'casual'
      : 'professional') as 'professional' | 'casual' | 'energetic' | 'calm';
    const contentType = (channelProfile.content_formats[0]?.format_id === 'news' ? 'news'
      : channelProfile.content_formats[0]?.format_id === 'analysis' ? 'analysis'
      : channelProfile.content_formats[0]?.format_id === 'entertainment' ? 'entertainment'
      : 'tutorial') as 'tutorial' | 'news' | 'analysis' | 'entertainment';
    if (isStageSkipped('voice_matching', pipelineMode)) {
      logger.info(`[6/9] Voice Matching SKIPPED (matchVoice only; visual kept) (PIPELINE_MODE=${pipelineMode})`, {
        projectId, stage: 'voice_matching', skipped: true,
      });
      progress.completeStage(ProcessingStage.VOICE_MATCHING, { skipped: true });
    } else {
      voice = matchVoice(mood, contentType, language);
      progress.completeStage(ProcessingStage.VOICE_MATCHING, {
        provider: voice?.provider,
        style: voice?.style
      });
    }

    // ============================================
    // Stage 7: NotebookLM Script Generation
    // ============================================
    progress.startStage(ProcessingStage.NOTEBOOKLM_GENERATION);
    if (isStageSkipped('notebooklm_generation', pipelineMode)) {
      logger.info(`[7/9] NotebookLM Generation SKIPPED (PIPELINE_MODE=${pipelineMode})`, {
        projectId, stage: 'notebooklm_generation', skipped: true,
      });
      progress.completeStage(ProcessingStage.NOTEBOOKLM_GENERATION, { skipped: true });
    } else {
      notebookLMScripts = await generateNotebookLMScripts(
        {
          projectId,
          projectDir,
          rawContent,
          languages: ['en', 'zh']
        },
        notebooklmClient,
        channelProfile
      );
      audioConfig = buildAudioConfig(notebookLMScripts);
      progress.completeStage(ProcessingStage.NOTEBOOKLM_GENERATION, {
        scriptsGenerated: notebookLMScripts.length,
        languages: notebookLMScripts.map(s => s.language)
      });
    }

    // ============================================
    // Stage 8: Manifest Update
    // ============================================
    progress.startStage(ProcessingStage.MANIFEST_UPDATE);

    // Calculate tokens used for this project
    const endTokens = provider.getTokenSnapshot();
    const projectTokensUsed = endTokens - startTokens;
    const globalCost = provider.getCostReport();
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
      m.meta.model_used = modelConfig.name;
      m.meta.is_fallback_mode = manifest.meta.is_fallback_mode;

      // Update per-project cost tracking
      m.meta.cost.total_tokens_used = projectTokensUsed;
      m.meta.cost.api_calls_count = globalCost.api_calls_count - (manifest.meta.cost?.api_calls_count ?? 0);
      // Estimate cost based on primary model used
      const pricePerMillion = modelConfig.name.includes('pro') ? 5.0 :
                              modelConfig.name.includes('2.5') ? 0.15 : 0.5;
      m.meta.cost.estimated_cost_usd = (projectTokensUsed / 1_000_000) * pricePerMillion;

      // Add NotebookLM audio configuration
      m.audio = audioConfig;

      // Add NotebookLM script metadata
      m.notebooklm_scripts = {};
      for (const script of notebookLMScripts) {
        m.notebooklm_scripts[script.language] = {
          title: script.metadata.bugReport.slice(0, 50) || channelProfile.channel_name,
          bug_report: script.metadata.bugReport,
          root_cause: script.metadata.rootCause,
          hotfix: script.metadata.hotfix,
          estimated_duration_minutes: script.metadata.estimatedDurationMinutes,
          shorts_count: script.metadata.shortsCount,
          generated_at: new Date().toISOString()
        };
      }

      // Populate quality scores from self-scoring results (default when Stage 2 skipped)
      m.quality_scores = {
        script_confidence: Math.max(1, Math.min(10, scriptConfidence)),
        retries_needed: scriptConfidence < channelProfile.quality.min_confidence_score ? 1 : 0,
      };
    });

    progress.completeStage(ProcessingStage.MANIFEST_UPDATE, {
      tokensUsed: projectTokensUsed,
      estimatedCostUsd: (projectTokensUsed / 1_000_000) * (modelConfig.name.includes('pro') ? 5.0 : modelConfig.name.includes('2.5') ? 0.15 : 0.5)
    });

    // ============================================
    // Stage 9: Finalization
    // ============================================
    progress.startStage(ProcessingStage.FINALIZATION);

    // analyzing -> pending_audio (waiting for NotebookLM audio generation)
    await workflowManager.transitionState(projectId, 'pending_audio');

    // Mark file as processed for duplicate detection
    await workflowManager.markFileAsProcessed(projectId);

    progress.completeStage(ProcessingStage.FINALIZATION);

    // Log pipeline completion summary
    progress.logPipelineComplete({
      modelUsed: modelConfig.name,
      tokensUsed: projectTokensUsed,
      trendCoverage: seoData.trend_coverage_score,
      shortsCount: shortsData.hooks.length,
      isDegraded: manifest.meta.is_degraded
    });

    // One-line LLM run summary (prefix-cache visibility — key for DeepSeek).
    // Reflects provider (non-NotebookLM) calls only; NotebookLM has no prefix cache.
    const endLlm = provider.getRunStats();
    const runCalls = endLlm.calls - startLlm.calls;
    const runLocalHits = endLlm.localCacheHits - startLlm.localCacheHits;
    const runInput = endLlm.inputTokens - startLlm.inputTokens; // real (non-cached) calls only
    const runCacheHit = endLlm.cacheHitTokens - startLlm.cacheHitTokens;
    const runOutput = endLlm.outputTokens - startLlm.outputTokens;
    const runCost = endLlm.costUsd - startLlm.costUsd;
    const realCalls = runCalls - runLocalHits;
    // prefix_cache = DeepSeek prompt_cache_hit ratio over real API calls; n/a if none.
    const prefixCache = realCalls > 0 && runInput > 0
      ? `${Math.round((runCacheHit / runInput) * 100)}%`
      : 'n/a';
    logger.info(
      `LLM: ${runCalls} calls | provider=${provider.name} | ` +
      `local_cache_hit=${runLocalHits}/${runCalls} | prefix_cache=${prefixCache} | $${runCost.toFixed(4)}`,
      { projectId, provider: provider.name, calls: runCalls, localCacheHits: runLocalHits, realCalls, inputTokens: runInput, cacheHitTokens: runCacheHit, outputTokens: runOutput, costUsd: runCost, prefixCache },
    );

    // Print Next Steps for NotebookLM audio generation (skipped in seo_only:
    // no scripts were generated, so the next step is `make seo`, not NotebookLM).
    if (notebookLMScripts.length > 0) {
      printNextSteps(projectId, projectDir, notebookLMScripts);
    } else {
      logger.info('SEO ready — run `make seo` to copy the metadata for upload', { projectId });
    }

  } catch (error) {
    // Log pipeline error with the stage that was actually running when it failed
    const failedStage = progress.getCurrentStage() ?? ProcessingStage.SCRIPT_GENERATION;
    progress.logPipelineError(failedStage, error as Error);
    // Use new intelligent error handling with degradation support
    await workflowManager.handleError(projectId, error as Error, 'analyzing');
  }
}

main().catch((error) => {
  logger.error('Fatal error during startup', { error: error.message });
  process.exit(1);
});
