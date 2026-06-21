import { z } from 'zod';
import { logger } from '../utils/logger';
import {
  coerceEnum,
  defaultIfMissing,
  truncateIfOverflow,
  truncateStringIfOverflow,
} from '../llm/schema-helpers';

// Allowed value sets for LLM-generated enum fields. Centralized so the schema
// coercion (coerceEnum) and any future prompt/eval tooling share one source.
export const VISUAL_HINTS = [
  'code_block', 'diagram', 'text_animation', 'b-roll', 'screen_recording', 'talking_head_placeholder',
] as const;
export const HOOK_TYPES = [
  'counter_intuitive', 'number_shock', 'controversy', 'quick_tip', 'fomo', 'curiosity', 'awe',
  'anger', 'validation', 'surprise', 'humor', 'empathy', 'urgency',
] as const;
export const EMOTIONAL_TRIGGERS = ['anger', 'awe', 'curiosity', 'fomo', 'validation'] as const;
export const ENGAGEMENT_LEVELS = ['low', 'medium', 'high'] as const;
export const CROP_FOCI = ['center', 'left', 'right', 'speaker', 'dynamic'] as const;
export const MUSIC_MOODS = ['upbeat', 'dramatic', 'chill', 'none'] as const;

// ============================================
// 错误指纹类型 (用于智能降级)
// ============================================

export const ErrorFingerprintSchema = z.object({
  type: z.enum([
    'zod_validation',      // Zod Schema 验证失败
    'gemini_api',          // Gemini API 错误
    'network',             // 网络错误
    'file_system',         // 文件系统错误
    'unknown'              // 未知错误
  ]),
  code: z.string(),        // 错误代码 (如 'invalid_enum_value')
  path: z.string().optional(),  // 错误路径 (如 'shorts.hooks[1].hook_type')
  message: z.string()
});

export const ErrorHistoryEntrySchema = z.object({
  timestamp: z.string().datetime(),
  error: z.string(),
  fingerprint: ErrorFingerprintSchema.optional(),
  stage: z.string(),
  model: z.string().optional()
});

// ============================================
// 基础类型定义
// ============================================

// LLM-generated (full-mode Stage 2). Every field defended: a bad timestamp/
// visual_hint/duration from the LLM must not reject the whole manifest.
export const ScriptSegmentSchema = z.object({
  timestamp: z.unknown().transform((val): string => {
    if (typeof val === 'string' && /^\d{2}:\d{2}$/.test(val)) return val;
    logger.warn('Invalid ScriptSegment.timestamp coerced to "00:00"', { received: val });
    return '00:00';
  }),
  voiceover: defaultIfMissing(z.string(), '', 'ScriptSegment.voiceover'),
  visual_hint: coerceEnum(VISUAL_HINTS, 'text_animation', 'ScriptSegment.visual_hint'),
  estimated_duration_seconds: z.number().positive().catch((ctx) => {
    logger.warn('Invalid ScriptSegment.estimated_duration_seconds, defaulting to 1', { received: ctx.input });
    return 1;
  }),
});

// ============================================
// 视觉 + 音频偏好 (传递给 video-renderer)
// ============================================

export const VoicePersonaSchema = z.object({
  // Fields are nullable so PIPELINE_MODE=seo_only can write an explicit
  // empty voice (skipped Stage 6 matchVoice) instead of omitting it.
  provider: z.enum(['elevenlabs', 'google_tts', 'azure']).nullable(),
  voice_id: z.string().nullable(),
  style: z.enum(['narrative', 'energetic', 'calm', 'professional']).nullable(),
  language: z.enum(['en', 'zh', 'ja', 'es', 'de']).nullable()
});

export const VisualPreferenceSchema = z.object({
  mood: z.enum(['professional', 'casual', 'energetic', 'calm']),
  content_type: z.enum(['tutorial', 'news', 'analysis', 'entertainment']),
  theme_suggestion: z.enum([
    'cyberpunk',
    'minimalist',
    'dark_mode',
    'whiteboard',
    'corporate'
  ]).optional()
});

export const MediaPreferenceSchema = z.object({
  visual: VisualPreferenceSchema,
  voice: VoicePersonaSchema.optional()
});

// ============================================
// 热词与权威性 (Trends Authority + Decay)
// ============================================

export const TrendKeywordSchema = z.object({
  keyword: z.string(),
  authority: z.enum(['fleeting', 'emerging', 'established']),
  consecutive_windows: z.number().min(1),
  first_seen: z.string().datetime(),
  last_seen: z.string().datetime(),
  decay_risk: z.boolean().default(false)
});

// ============================================
// SEO 数据 (核心商业逻辑)
// ============================================

// FAQ items come straight from LLM JSON (generateFAQ -> parsed.faq). Every field
// is defended: missing `related_entities` was the ep58 crash; `answer`/`question`
// can be absent and `answer`/`related_entities` can overrun their caps. See
// llm/schema-helpers.ts for the coerce-with-warn rationale.
export const FAQItemSchema = z.object({
  question: defaultIfMissing(z.string(), '', 'FAQItem.question'),
  answer: defaultIfMissing(truncateStringIfOverflow(200, 'FAQItem.answer'), '', 'FAQItem.answer'),
  related_entities: defaultIfMissing(
    truncateIfOverflow(z.array(z.string()), 3, 'FAQItem.related_entities'),
    [],
    'FAQItem.related_entities',
  ),
});

// LLM-generated enum field: coerce, don't hard-reject. The LLM invents more
// "precise" types for unfamiliar domains (e.g. "algorithm"/"data_structure" for
// graph-theory koans), which would crash Stage 9 validation for the whole
// pipeline. Unknown values degrade to "concept" (the catch-all) with a warning.
export const VALID_ENTITY_TYPES = ['tool', 'concept', 'person', 'company', 'technology'] as const;
export type ValidEntityType = (typeof VALID_ENTITY_TYPES)[number];

export const EntityTypeSchema = coerceEnum(VALID_ENTITY_TYPES, 'concept', 'Entity.type');

export const EntitySchema = z.object({
  name: defaultIfMissing(z.string(), '', 'Entity.name'),
  type: EntityTypeSchema,
  // Permissive for AI-generated SEO descriptions; truncate rather than reject.
  description: truncateStringIfOverflow(1000, 'Entity.description').optional(),
  wiki_link: z.string().url().optional()
});

// SEO regional variants: zh_TW (YouTube main channel) + zh_CN_XHS (小红书).
// Collapsed from 5 (en/zh/es/ja/de) — the active use case is Chinese-only.
export const SUPPORTED_LOCALES = ['zh_TW', 'zh_CN_XHS'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const RegionalSEOSchema = z.object({
  language: z.enum(SUPPORTED_LOCALES),
  // Forward-compatible array shape; the Phase-5+ pipeline emits exactly one
  // templated title (hook | chineseName | csConceptEn). Extra slots remain
  // available for multi-title experiments without schema churn.
  titles: z.array(z.string()).min(1).max(5),
  description: z.string().max(5000),
  // FAQ is per-locale (V4): each locale gets its own Chinese-language FAQ
  // (was a single top-level English faq_structured_data shared across locales).
  faq: z.array(FAQItemSchema).max(5).default([]),
  contains_established_trend: z.boolean()
});

export const SEODataSchema = z.object({
  primary_language: z.enum(['en', 'zh']),
  tags: z.array(z.string()).max(30),
  chapters: z.string().default(''),
  regional_seo: z.array(RegionalSEOSchema).length(2),
  entities: z.array(EntitySchema).max(10),
  injected_trends: z.array(TrendKeywordSchema).max(5).optional(),
  trend_coverage_score: z.number().min(0).max(100)
});

// ============================================
// Shorts 提取 (情绪弧度 + CTA 注入)
// ============================================

export const EmotionalTriggerSchema = coerceEnum(
  EMOTIONAL_TRIGGERS, 'curiosity', 'ShortsHook.emotional_trigger',
);

// LLM-generated (full-mode Stage 5, parsed.hooks). Enums coerce, the engagement
// object defaults whole-or-per-field, score clamps, text truncates.
export const ShortsHookSchema = z.object({
  text: defaultIfMissing(truncateStringIfOverflow(50, 'ShortsHook.text'), '', 'ShortsHook.text'),
  timestamp_start: defaultIfMissing(z.string(), '', 'ShortsHook.timestamp_start'),
  timestamp_end: defaultIfMissing(z.string(), '', 'ShortsHook.timestamp_end'),
  hook_type: coerceEnum(HOOK_TYPES, 'quick_tip', 'ShortsHook.hook_type'),
  emotional_trigger: EmotionalTriggerSchema,
  controversy_score: z.number().catch(0).transform((n): number => {
    const clamped = Math.max(0, Math.min(10, n));
    if (clamped !== n) {
      logger.warn('ShortsHook.controversy_score clamped to [0,10]', { received: n, clamped });
    }
    return clamped;
  }),
  predicted_engagement: defaultIfMissing(
    z.object({
      comments: coerceEnum(ENGAGEMENT_LEVELS, 'medium', 'ShortsHook.predicted_engagement.comments'),
      shares: coerceEnum(ENGAGEMENT_LEVELS, 'medium', 'ShortsHook.predicted_engagement.shares'),
      completion_rate: coerceEnum(ENGAGEMENT_LEVELS, 'medium', 'ShortsHook.predicted_engagement.completion_rate'),
    }),
    { comments: 'medium', shares: 'medium', completion_rate: 'medium' },
    'ShortsHook.predicted_engagement',
  ),
  injected_cta: z.string().max(30).optional().describe('针对 anger 类型自动注入')
});

export const ShortsExtractionSchema = z.object({
  // Empty hooks = honest skipped Stage 5 (seo_only); truncate rather than reject
  // if the LLM returns >5. crop/music are nullable (null = skipped) and coerce
  // invalid strings while preserving null/undefined.
  hooks: truncateIfOverflow(z.array(ShortsHookSchema), 5, 'ShortsExtraction.hooks'),
  vertical_crop_focus: z.unknown().transform((val): (typeof CROP_FOCI)[number] | null => {
    if (val === null || val === undefined) return null;
    if (typeof val === 'string' && (CROP_FOCI as readonly string[]).includes(val)) {
      return val as (typeof CROP_FOCI)[number];
    }
    logger.warn('Invalid ShortsExtraction.vertical_crop_focus coerced to "center"', { received: val });
    return 'center';
  }),
  recommended_music_mood: z.unknown().transform((val): (typeof MUSIC_MOODS)[number] | null | undefined => {
    if (val === undefined) return undefined;
    if (val === null) return null;
    if (typeof val === 'string' && (MUSIC_MOODS as readonly string[]).includes(val)) {
      return val as (typeof MUSIC_MOODS)[number];
    }
    logger.warn('Invalid ShortsExtraction.recommended_music_mood coerced to "none"', { received: val });
    return 'none';
  }),
  face_detection_hint: z.boolean().default(false).describe('是否需要人脸检测')
});

// ============================================
// 原创性评分 (Originality Validation)
// ============================================

export const OriginalityScoreSchema = z.object({
  visual_text_match: z.number().min(0).max(1),
  semantic_uniqueness: z.number().min(0).max(1),
  style_fingerprint: z.string(),
  overall_score: z.number().min(0).max(1),
  is_original: z.boolean(),
  warnings: z.array(z.string()),
  suggestions: z.array(z.string())
});

// ============================================
// 变现信息 (Monetization)
// ============================================

export const MonetizationInfoSchema = z.object({
  ad_suitability_score: z.number().min(0).max(100),
  ad_suitability_level: z.enum(['safe', 'moderate', 'risky', 'blocked']),
  estimated_cpm_range: z.tuple([z.number(), z.number()]),
  safe_regions: z.array(z.string()),
  blocked_regions: z.array(z.string()),
  optimization_applied: z.boolean()
});

// ============================================
// 内容日历 (Content Planning)
// ============================================

export const ContentPlanSchema = z.object({
  topic: z.string(),
  scheduled_date: z.string().datetime(),
  quarter: z.enum(['Q1', 'Q2', 'Q3', 'Q4']),
  content_type: z.enum(['evergreen', 'trending', 'commercial', 'mixed']),
  priority: z.enum(['high', 'medium', 'low']),
  seasonal_angle: z.string().optional(),
  estimated_cpm_multiplier: z.number().default(1)
});

// ============================================
// AIO 扩展 FAQ (Extended FAQ with AIO)
// ============================================

export const ExtendedFAQItemSchema = FAQItemSchema.extend({
  timestamp: z.string().optional(),
  schema_markup: z.record(z.string(), z.unknown()).optional()
});

// ============================================
// Shorts 候选 (Emotion-based)
// ============================================

export const ShortsCandidateSchema = z.object({
  start_time: z.number(),
  end_time: z.number(),
  emotion: z.enum(['controversy', 'fomo', 'curiosity', 'anger', 'awe', 'surprise', 'humor']),
  controversy_score: z.number().min(0).max(10),
  hook_strength: z.number().min(0).max(10),
  recommended_cta: z.string(),
  transcript_snippet: z.string()
});

// ============================================
// NotebookLM Audio Configuration
// ============================================

export const AudioLanguageConfigSchema = z.object({
  script_path: z.string(),
  audio_path: z.string(),
  audio_status: z.enum(['pending', 'ready']),
  duration_seconds: z.number().nullable()
});

export const NotebookLMAudioConfigSchema = z.object({
  // nullable: PIPELINE_MODE=seo_only skips Stage 7 and writes { source: null, languages: {} }.
  source: z.enum(['notebooklm', 'azure_tts', 'manual']).nullable(),
  languages: z.object({
    en: AudioLanguageConfigSchema.optional(),
    zh: AudioLanguageConfigSchema.optional()
  })
});

// LLM-generated (full-mode Stage 7) narrative strings — default rather than
// reject if the model omits one. Numbers/datetime are code-supplied with fallbacks.
export const NotebookLMScriptMetadataSchema = z.object({
  title: defaultIfMissing(z.string(), '', 'NotebookLMScriptMetadata.title'),
  bug_report: defaultIfMissing(z.string(), '', 'NotebookLMScriptMetadata.bug_report'),
  root_cause: defaultIfMissing(z.string(), '', 'NotebookLMScriptMetadata.root_cause'),
  hotfix: defaultIfMissing(z.string(), '', 'NotebookLMScriptMetadata.hotfix'),
  estimated_duration_minutes: z.number(),
  shorts_count: z.number(),
  generated_at: z.string().datetime()
});

// ============================================
// 成本追踪 (Cost Awareness)
// ============================================

export const CostTrackingSchema = z.object({
  total_tokens_used: z.number().default(0),
  // Open record: accumulates whatever models actually run (deepseek-v4-flash,
  // gemini-2.5-pro, etc.) instead of a hardcoded gemini-3 key set.
  tokens_by_model: z.record(z.string(), z.number()).default({}),
  estimated_cost_usd: z.number().default(0),
  api_calls_count: z.number().default(0)
});

// ============================================
// 质量评分 (Quality Tracking)
// ============================================

export const QualityScoresSchema = z.object({
  script_confidence: z.number().min(1).max(10).optional(),
  seo_confidence: z.number().min(1).max(10).optional(),
  notebooklm_confidence: z.number().min(1).max(10).optional(),
  best_title_ctr_score: z.number().min(1).max(10).optional(),
  retries_needed: z.number().default(0),
});

// ============================================
// 完整 Project Manifest
// ============================================

export const ProjectManifestSchema = z.object({
  // 基础标识
  project_id: z.string().uuid(),
  status: z.enum([
    'pending',
    'analyzing',
    'pending_audio',     // 等待 NotebookLM 音频生成
    'rendering',
    'uploading',
    'completed',
    'failed',
    'stale_recovered',
    'dead_letter',       // 死信状态
    'degraded_retry'     // 降级重试状态
  ]),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),

  // 输入源
  input_source: z.object({
    local_path: z.string(),
    raw_content: z.string(),
    detected_language: z.enum(['en', 'zh']).optional(),
    word_count: z.number().positive(),
    estimated_reading_time_minutes: z.number().positive()
  }),

  // 内容引擎输出
  content_engine: z.object({
    script: z.array(ScriptSegmentSchema),
    seo: SEODataSchema,
    shorts: ShortsExtractionSchema,
    // nonnegative (not positive): PIPELINE_MODE=seo_only skips Stage 2, so there
    // is no script and 0 is the honest duration.
    estimated_duration_seconds: z.number().nonnegative(),
    media_preference: MediaPreferenceSchema
  }).optional(),

  // 资产路径
  assets: z.object({
    audio_url: z.string().url().optional(),
    video_url: z.string().url().optional(),
    shorts_urls: z.array(z.string().url()).optional(),
    thumbnail_url: z.string().url().optional()
  }).default({}),

  // 错误追踪
  error: z.object({
    stage: z.string(),
    message: z.string(),
    retries: z.number(),
    last_retry_at: z.string().datetime(),
    fallback_model_used: z.string().optional()
  }).optional(),

  // 变现信息
  monetization: MonetizationInfoSchema.optional(),

  // 原创性评分
  originality: OriginalityScoreSchema.optional(),

  // NotebookLM 音频配置
  audio: NotebookLMAudioConfigSchema.optional(),

  // NotebookLM 脚本元数据
  notebooklm_scripts: z.object({
    en: NotebookLMScriptMetadataSchema.optional(),
    zh: NotebookLMScriptMetadataSchema.optional()
  }).optional(),

  // 质量评分
  quality_scores: QualityScoresSchema.optional(),

  // 运维元数据
  meta: z.object({
    stale_recovery_count: z.number().default(0),
    processing_time_ms: z.number().optional(),
    model_used: z.string().default('gemini-2.5-pro'),
    is_fallback_mode: z.boolean().default(false),
    trends_authority_score: z.number().min(0).max(100).optional(),
    cost: CostTrackingSchema.default({
      total_tokens_used: 0,
      tokens_by_model: {},
      estimated_cost_usd: 0,
      api_calls_count: 0
    }),
    // 错误追踪
    retry_count: z.number().default(0),
    error_fingerprint: ErrorFingerprintSchema.optional(),
    error_history: z.array(ErrorHistoryEntrySchema).default([]),
    // 模型降级追踪
    used_models: z.array(z.string()).default([]),
    current_model: z.string().optional(),
    is_degraded: z.boolean().default(false),
    // 死信标记
    is_dead_letter: z.boolean().default(false),
    // 追踪 ID
    trace_id: z.string().uuid().optional(),
    gateway_trace_id: z.string().optional(),
    // 文件信息
    file_hash: z.string().optional(),
    file_size: z.number().optional()
  }).default({
    stale_recovery_count: 0,
    model_used: 'gemini-2.5-pro',
    is_fallback_mode: false,
    cost: {
      total_tokens_used: 0,
      tokens_by_model: {},
      estimated_cost_usd: 0,
      api_calls_count: 0
    },
    retry_count: 0,
    error_history: [],
    used_models: [],
    is_degraded: false,
    is_dead_letter: false
  })
});

// Type exports
export type ProjectManifest = z.infer<typeof ProjectManifestSchema>;
export type ScriptSegment = z.infer<typeof ScriptSegmentSchema>;
export type VoicePersona = z.infer<typeof VoicePersonaSchema>;
export type SEOData = z.infer<typeof SEODataSchema>;
export type ShortsExtraction = z.infer<typeof ShortsExtractionSchema>;
export type ShortsHook = z.infer<typeof ShortsHookSchema>;
export type MediaPreference = z.infer<typeof MediaPreferenceSchema>;
export type TrendKeyword = z.infer<typeof TrendKeywordSchema>;
export type CostTracking = z.infer<typeof CostTrackingSchema>;
export type OriginalityScore = z.infer<typeof OriginalityScoreSchema>;
export type MonetizationInfo = z.infer<typeof MonetizationInfoSchema>;
export type ContentPlan = z.infer<typeof ContentPlanSchema>;
export type ExtendedFAQItem = z.infer<typeof ExtendedFAQItemSchema>;
export type ShortsCandidate = z.infer<typeof ShortsCandidateSchema>;
export type ErrorFingerprint = z.infer<typeof ErrorFingerprintSchema>;
export type ErrorHistoryEntry = z.infer<typeof ErrorHistoryEntrySchema>;
export type RegionalSEO = z.infer<typeof RegionalSEOSchema>;
export type AudioLanguageConfig = z.infer<typeof AudioLanguageConfigSchema>;
export type NotebookLMAudioConfig = z.infer<typeof NotebookLMAudioConfigSchema>;
export type NotebookLMScriptMetadata = z.infer<typeof NotebookLMScriptMetadataSchema>;
export type QualityScores = z.infer<typeof QualityScoresSchema>;
