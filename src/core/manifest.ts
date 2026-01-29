import { z } from 'zod';

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

export const ScriptSegmentSchema = z.object({
  timestamp: z.string().regex(/^\d{2}:\d{2}$/),
  voiceover: z.string().min(1),
  visual_hint: z.enum([
    'code_block',
    'diagram',
    'text_animation',
    'b-roll',
    'screen_recording',
    'talking_head_placeholder'
  ]),
  estimated_duration_seconds: z.number().positive()
});

// ============================================
// 视觉 + 音频偏好 (传递给 video-renderer)
// ============================================

export const VoicePersonaSchema = z.object({
  provider: z.enum(['elevenlabs', 'google_tts', 'azure']),
  voice_id: z.string(),
  style: z.enum(['narrative', 'energetic', 'calm', 'professional']),
  language: z.enum(['en', 'zh', 'ja', 'es', 'de'])
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

export const FAQItemSchema = z.object({
  question: z.string(),
  answer: z.string().max(200),
  related_entities: z.array(z.string()).max(3)
});

export const EntitySchema = z.object({
  name: z.string(),
  type: z.enum(['tool', 'concept', 'person', 'company', 'technology']),
  description: z.string().max(1000).optional(),  // Permissive for AI-generated SEO descriptions
  wiki_link: z.string().url().optional()
});

export const RegionalSEOSchema = z.object({
  language: z.enum(['en', 'zh', 'es', 'ja', 'de']),
  titles: z.array(z.string()).length(5),
  description: z.string().max(5000),
  cultural_hooks: z.array(z.string()).max(3),
  contains_established_trend: z.boolean()
});

export const SEODataSchema = z.object({
  primary_language: z.enum(['en', 'zh']),
  tags: z.array(z.string()).max(30),
  chapters: z.string(),
  regional_seo: z.array(RegionalSEOSchema).min(2),
  faq_structured_data: z.array(FAQItemSchema).max(5),
  entities: z.array(EntitySchema).max(10),
  injected_trends: z.array(TrendKeywordSchema).max(5).optional(),
  trend_coverage_score: z.number().min(0).max(100)
});

// ============================================
// Shorts 提取 (情绪弧度 + CTA 注入)
// ============================================

export const EmotionalTriggerSchema = z.enum([
  'anger',
  'awe',
  'curiosity',
  'fomo',
  'validation'
]);

export const ShortsHookSchema = z.object({
  text: z.string().max(50),
  timestamp_start: z.string(),
  timestamp_end: z.string(),
  hook_type: z.enum([
    'counter_intuitive',
    'number_shock',
    'controversy',
    'quick_tip',
    'fomo',
    'curiosity',
    'awe',
    'anger',
    'validation',
    'surprise',
    'humor',
    'empathy',
    'urgency'
  ]),
  emotional_trigger: EmotionalTriggerSchema,
  controversy_score: z.number().min(0).max(10),
  predicted_engagement: z.object({
    comments: z.enum(['low', 'medium', 'high']),
    shares: z.enum(['low', 'medium', 'high']),
    completion_rate: z.enum(['low', 'medium', 'high'])
  }),
  injected_cta: z.string().max(30).optional().describe('针对 anger 类型自动注入')
});

export const ShortsExtractionSchema = z.object({
  hooks: z.array(ShortsHookSchema).min(1).max(5),
  vertical_crop_focus: z.enum(['center', 'left', 'right', 'speaker', 'dynamic']),
  recommended_music_mood: z.enum(['upbeat', 'dramatic', 'chill', 'none']).optional(),
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
// 成本追踪 (Cost Awareness)
// ============================================

export const CostTrackingSchema = z.object({
  total_tokens_used: z.number().default(0),
  tokens_by_model: z.object({
    'gemini-3-pro-preview': z.number().default(0),
    'gemini-3-flash-preview': z.number().default(0),
    'gemini-2.5-flash': z.number().default(0)
  }).default({
    'gemini-3-pro-preview': 0,
    'gemini-3-flash-preview': 0,
    'gemini-2.5-flash': 0
  }),
  estimated_cost_usd: z.number().default(0),
  api_calls_count: z.number().default(0)
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
    estimated_duration_seconds: z.number().positive(),
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

  // 运维元数据
  meta: z.object({
    stale_recovery_count: z.number().default(0),
    processing_time_ms: z.number().optional(),
    model_used: z.string().default('gemini-3-pro-preview'),
    is_fallback_mode: z.boolean().default(false),
    trends_authority_score: z.number().min(0).max(100).optional(),
    cost: CostTrackingSchema.default({
      total_tokens_used: 0,
      tokens_by_model: {
        'gemini-3-pro-preview': 0,
        'gemini-3-flash-preview': 0,
        'gemini-2.5-flash': 0
      },
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
    is_dead_letter: false
  })
});

// Type exports
export type ProjectManifest = z.infer<typeof ProjectManifestSchema>;
export type ScriptSegment = z.infer<typeof ScriptSegmentSchema>;
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
