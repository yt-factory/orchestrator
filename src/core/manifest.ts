import { z } from 'zod';

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
  description: z.string().max(100).optional(),
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
    'quick_tip'
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
// 成本追踪 (Cost Awareness)
// ============================================

export const CostTrackingSchema = z.object({
  total_tokens_used: z.number().default(0),
  tokens_by_model: z.object({
    'gemini-2.0-pro': z.number().default(0),
    'gemini-2.0-flash': z.number().default(0),
    'gemini-1.5-flash': z.number().default(0)
  }).default({}),
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
    'stale_recovered'
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

  // 运维元数据
  meta: z.object({
    stale_recovery_count: z.number().default(0),
    processing_time_ms: z.number().optional(),
    model_used: z.string().default('gemini-2.0-pro'),
    is_fallback_mode: z.boolean().default(false),
    trends_authority_score: z.number().min(0).max(100).optional(),
    cost: CostTrackingSchema.default({})
  }).default({})
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
