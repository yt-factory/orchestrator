# CLAUDE.md - YT-Factory Orchestrator
## Production-Ready Final Version (2026)

---

## Recent Changes (March 2026)

### Content Quality System (Phase 1-2)

New files added to the orchestrator:

| File | Purpose |
|------|---------|
| `src/core/channel-profile.ts` | Channel Profile schema (Zod) + ChannelProfileManager |
| `channels/default/profile.json` | Default channel profile (general tech/education) |
| `src/prompts/self-scoring.ts` | Self-scoring generation wrapper (confidence 1-10 + retry) |
| `src/prompts/script-prompt-builder.ts` | Channel-aware script prompt templates |
| `src/prompts/title-ranker.ts` | CTR-based title scoring and selection |
| `src/services/analytics-feedback.ts` | Video performance analysis + profile updater |
| `src/services/performance-loader.ts` | Scans completed projects for metrics |
| `src/cli/feedback.ts` | CLI: `bun run feedback [--channel=default] [--days=30] [--dry-run]` |
| `src/cli/channel.ts` | CLI: `bun run channel create/show/list` |

### How the Quality System Works

1. **Channel Profile** (`channels/{id}/profile.json`) defines channel identity, audience, voice, quality criteria
2. **Script generation** uses `buildScriptPrompt()` which injects profile context into the Gemini prompt
3. **Self-scoring**: Gemini rates its own output confidence in the same API call. If below `quality.min_confidence_score`, retries once with self-feedback
4. **Title ranking**: After generating 5 titles, `rankTitles()` scores them for CTR and reorders (best first)
5. **Analytics feedback**: `bun run feedback` analyzes completed projects and evolves the Channel Profile

### Key Integration Points

- `src/index.ts` loads channel profile at pipeline start, passes to all generators
- `src/agents/seo-expert.ts` accepts `profile: ChannelProfile` and injects voice/audience into regional personas
- `src/agents/notebooklm-generator.ts` accepts optional `profile?: ChannelProfile` and prepends channel identity
- `src/core/manifest.ts` has `quality_scores` field tracking confidence and retries
- `generateMultiLangSEO()` signature: `(rawContent, projectId, geminiClient, trendsHook, channelProfile)`

---

## 🎯 Role Definition

你是一名资深的 **Full-stack Platform Engineer & YouTube Automation Expert**。
你正在构建 `yt-factory/orchestrator` —— 一个 YouTube 自动化生产线的"大脑中枢"。

这不仅仅是写代码，而是构建一个能够调度 AI 代理和多媒体工具的**生产控制系统**。

**核心原则：**
- **永不停摆**：多级 Fallback 保证 24/7 产出
- **成本可控**：Token 追踪 + 优先级队列
- **流量攻击性**：热词权威性 + 情绪弧度 + AIO 优化

---

## 🏗️ Architecture Overview

```
┌───────────────────────────────────────────────────────────────────────┐
│                    YT-Factory Ecosystem (2026 Final)                   │
├───────────────────────────────────────────────────────────────────────┤
│                                                                       │
│   ┌─────────────────────────────────────────────────────────────┐    │
│   │                    REQUEST FLOW CONTROL                      │    │
│   │  Priority Queue → Token Bucket (60/min) → Gemini SDK        │    │
│   │       │                  │                      │            │    │
│   │   [HIGH] Script      [MEDIUM] SEO         [LOW] Shorts      │    │
│   └─────────────────────────────────────────────────────────────┘    │
│                              │                                        │
│                              ▼                                        │
│   [orchestrator] ─────────────────────────> Gemini 3 Pro/Flash       │
│        │              (@google/generative-ai SDK)                    │
│        │                                                              │
│        ├──MCP──> [mcp-gateway] ──> Google Trends API                 │
│        │                       └──> YouTube Data API                  │
│        │                                                              │
│        │ (manifest.json)                                              │
│        ▼                                                              │
│   [video-renderer] ──> MP4 + Shorts (9:16) ──> YouTube Upload        │
│                                                                       │
│   ┌─────────────────────────────────────────────────────────────┐    │
│   │  Fallback Chain: 3-Pro (3x) → 3-Flash (3x) → 2.5-Flash (3x) │    │
│   │  + Prompt Simplification on Fallback Mode                    │    │
│   └─────────────────────────────────────────────────────────────┘    │
│                                                                       │
└───────────────────────────────────────────────────────────────────────┘
```

---

## 🛠️ Tech Stack

| Component | Technology | Purpose |
|-----------|------------|---------|
| Runtime | Bun | 高性能 TypeScript 运行时 |
| Language | TypeScript (Strict Mode) | 类型安全 |
| Validation | Zod | Runtime schema validation |
| File Watch | chokidar | 目录监控 |
| AI SDK | @google/generative-ai | Gemini 3 text generation |
| Protocol | MCP SDK | 与 Gateway (YouTube/Trends) 通信 |
| Rate Limiting | Token Bucket + Priority Queue | 平滑请求 + 优先级控制 |
| ID Generation | uuid | 项目唯一标识 |

---

## 📂 Project Structure

```
orchestrator/
├── src/
│   ├── core/
│   │   ├── watcher.ts          # 文件夹监控 (chokidar)
│   │   ├── workflow.ts         # 状态机 + Heartbeat + Stale Recovery
│   │   └── manifest.ts         # Zod Schema 定义 & 数据操作
│   ├── agents/
│   │   ├── gemini-client.ts        # MCP 客户端 (连接池 + Warm-up + Fallback + Prompt简化)
│   │   ├── seo-expert.ts           # SEO Prompt 逻辑 (双角色 + 强制热词覆盖)
│   │   ├── trends-hook.ts          # Google Trends (Authority 分级 + 衰减)
│   │   ├── shorts-extractor.ts     # Shorts 提取 (情绪弧度 + CTA 注入)
│   │   ├── voice-matcher.ts        # Voice Persona 推荐
│   │   └── notebooklm-generator.ts # NotebookLM 脚本生成 (双语播客 + 音频检测)
│   ├── validators/              # Part 2: 内容验证模块
│   │   └── originality-checker.ts  # 原创性检测 (视觉80% + 语义70% + 风格指纹)
│   ├── shorts/                  # Part 2: Shorts 高级提取
│   │   └── emotion-extractor.ts    # 情感弧度提取 (7种情绪 + 病毒潜力评分)
│   ├── seo/                     # Part 2: SEO 高级优化
│   │   ├── faq-generator.ts        # AIO优化FAQ生成 (6种AIO模式 + Schema.org)
│   │   └── regional-optimizer.ts   # 多区域SEO (6市场 + CPM优先级)
│   ├── planning/                # Part 2: 内容规划
│   │   └── seasonal-planner.ts     # 季度规划 (Q4峰值 2.5x CPM)
│   ├── services/                # Part 2: 变现服务
│   │   ├── monetization-optimizer.ts  # 广告适配预评分 (5维风险分析)
│   │   └── aio-feedback-loop.ts       # AIO引用性能学习 (持久化ML)
│   ├── infra/
│   │   ├── token-bucket.ts     # Rate Limiting
│   │   ├── priority-queue.ts   # 请求优先级队列
│   │   └── connection-pool.ts  # 连接池封装
│   ├── cache/
│   │   └── trends-cache.ts     # 热词缓存 (6h TTL + Authority + Decay)
│   ├── utils/
│   │   ├── logger.ts           # 结构化日志 (必须含 project_id)
│   │   ├── retry.ts            # 指数退避重试
│   │   └── cost-tracker.ts     # Token 使用量追踪
│   └── index.ts                # 入口文件 (Warm-up 顺序严格)
├── incoming/                    # 监控目录 (手动创建)
├── active_projects/             # 活跃项目目录 (手动创建)
├── data/
│   ├── trends_authority.json   # 热词权威性持久化
│   ├── aio_feedback.json       # AIO引用学习数据
│   └── cost_report.json        # Token 成本追踪
├── .env
├── package.json
├── tsconfig.json
└── CLAUDE.md
```

---

## 📋 Source of Truth: Project Manifest Schema

所有仓库间通信必须遵循此 Schema：

```typescript
// src/core/manifest.ts

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
  last_seen: z.string().datetime(),  // NEW: 用于衰减计算
  decay_risk: z.boolean().default(false)  // NEW: 24h 未出现标记
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
  contains_established_trend: z.boolean()  // NEW: 强制热词覆盖验证
});

export const SEODataSchema = z.object({
  primary_language: z.enum(['en', 'zh']),
  tags: z.array(z.string()).max(30),
  chapters: z.string(),
  regional_seo: z.array(RegionalSEOSchema).min(2),
  faq_structured_data: z.array(FAQItemSchema).max(5),
  entities: z.array(EntitySchema).max(10),
  injected_trends: z.array(TrendKeywordSchema).max(5).optional(),
  trend_coverage_score: z.number().min(0).max(100)  // NEW: 热词覆盖率
});

// ============================================
// Shorts 提取 (情绪弧度 + CTA 注入)
// ============================================

export const EmotionalTriggerSchema = z.enum([
  'anger',      // 愤怒 → 高评论率
  'awe',        // 惊叹 → 高分享率
  'curiosity',  // 好奇 → 高完播率
  'fomo',       // 错失恐惧 → 高点击率
  'validation'  // 认同感 → 高点赞率
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
  // NEW: CTA 注入
  injected_cta: z.string().max(30).optional().describe('针对 anger 类型自动注入')
});

export const ShortsExtractionSchema = z.object({
  hooks: z.array(ShortsHookSchema).min(1).max(5),
  vertical_crop_focus: z.enum(['center', 'left', 'right', 'speaker', 'dynamic']),
  recommended_music_mood: z.enum(['upbeat', 'dramatic', 'chill', 'none']).optional(),
  // NEW: 动态对焦提示
  face_detection_hint: z.boolean().default(false).describe('是否需要人脸检测')
});

// ============================================
// 成本追踪 (Cost Awareness)
// ============================================

export const CostTrackingSchema = z.object({
  total_tokens_used: z.number().default(0),
  tokens_by_model: z.object({
    'gemini-3-pro': z.number().default(0),
    'gemini-3-flash': z.number().default(0),
    'gemini-2.5-flash': z.number().default(0)
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
  
  // 运维元数据 (增强版)
  meta: z.object({
    stale_recovery_count: z.number().default(0),
    processing_time_ms: z.number().optional(),
    model_used: z.string().default('gemini-3-pro'),
    is_fallback_mode: z.boolean().default(false),  // NEW
    trends_authority_score: z.number().min(0).max(100).optional(),
    cost: CostTrackingSchema.default({})  // NEW
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
```

---

## 🎯 Implementation Tasks

### Task 1: Project Initialization

```bash
bun init
bun add chokidar zod uuid dotenv @modelcontextprotocol/sdk generic-pool
bun add -d @types/node typescript

# 手动创建必要目录
mkdir -p incoming active_projects data
```

配置 `tsconfig.json`：
```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "outDir": "./dist",
    "rootDir": "./src",
    "skipLibCheck": true
  },
  "include": ["src/**/*"]
}
```

---

### Task 2: FolderWatcher (src/core/watcher.ts)

**Requirements:**
- 使用 chokidar 监听 `./incoming` 目录
- 支持 `.md`, `.txt`, `.markdown` 文件
- 文件稳定后（无写入 2 秒）触发处理
- 处理后移动到 `./incoming/processed/`
- 计算字数和预估阅读时间

```typescript
import chokidar from 'chokidar';
import { readFile, rename, mkdir } from 'fs/promises';
import { join, basename } from 'path';
import { logger } from '../utils/logger';

interface FileMetadata {
  path: string;
  content: string;
  wordCount: number;
  estimatedReadingTimeMinutes: number;
  detectedLanguage: 'en' | 'zh';
}

interface WatcherConfig {
  incomingDir: string;
  processedDir: string;
  stabilityDelayMs: number;
}

interface WatcherEvents {
  onFileReady: (metadata: FileMetadata) => Promise<void>;
  onError: (error: Error, filePath?: string) => void;
}

export class FolderWatcher {
  private watcher: chokidar.FSWatcher | null = null;
  private pendingFiles: Map<string, NodeJS.Timeout> = new Map();
  
  constructor(
    private config: WatcherConfig,
    private events: WatcherEvents
  ) {}
  
  async start(): Promise<void> {
    // 确保 processed 目录存在
    await mkdir(this.config.processedDir, { recursive: true });
    
    this.watcher = chokidar.watch(this.config.incomingDir, {
      ignored: /(^|[\/\\])\../, // 忽略隐藏文件
      persistent: true,
      awaitWriteFinish: {
        stabilityThreshold: this.config.stabilityDelayMs,
        pollInterval: 100
      }
    });
    
    this.watcher.on('add', (filePath) => this.handleFileAdd(filePath));
    this.watcher.on('error', (error) => this.events.onError(error));
    
    logger.info('FolderWatcher started', { 
      dir: this.config.incomingDir,
      stabilityDelayMs: this.config.stabilityDelayMs
    });
  }
  
  async stop(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
    
    // 清理所有 pending timers
    for (const timer of this.pendingFiles.values()) {
      clearTimeout(timer);
    }
    this.pendingFiles.clear();
    
    logger.info('FolderWatcher stopped');
  }
  
  private async handleFileAdd(filePath: string): Promise<void> {
    const ext = filePath.toLowerCase();
    if (!ext.endsWith('.md') && !ext.endsWith('.txt') && !ext.endsWith('.markdown')) {
      return;
    }
    
    try {
      const content = await readFile(filePath, 'utf-8');
      const metadata = this.analyzeContent(filePath, content);
      
      logger.info('File detected', { 
        path: filePath,
        wordCount: metadata.wordCount,
        language: metadata.detectedLanguage
      });
      
      await this.events.onFileReady(metadata);
      
      // 移动到 processed
      const newPath = join(this.config.processedDir, basename(filePath));
      await rename(filePath, newPath);
      
      logger.info('File processed and moved', { 
        from: filePath,
        to: newPath
      });
    } catch (error) {
      this.events.onError(error as Error, filePath);
    }
  }
  
  private analyzeContent(path: string, content: string): FileMetadata {
    const detectedLanguage = this.detectLanguage(content);
    const wordCount = this.countWords(content, detectedLanguage);
    const estimatedReadingTimeMinutes = this.calculateReadingTime(wordCount, detectedLanguage);
    
    return {
      path,
      content,
      wordCount,
      estimatedReadingTimeMinutes,
      detectedLanguage
    };
  }
  
  private detectLanguage(content: string): 'en' | 'zh' {
    // 简单检测：中文字符占比 > 30% 则认为是中文
    const chineseChars = content.match(/[\u4e00-\u9fa5]/g) || [];
    const ratio = chineseChars.length / content.length;
    return ratio > 0.3 ? 'zh' : 'en';
  }
  
  private countWords(content: string, language: 'en' | 'zh'): number {
    if (language === 'zh') {
      // 中文按字符计数
      return (content.match(/[\u4e00-\u9fa5]/g) || []).length;
    }
    // 英文按单词计数
    return content.split(/\s+/).filter(Boolean).length;
  }
  
  private calculateReadingTime(wordCount: number, language: 'en' | 'zh'): number {
    // 英文: ~200 words/min, 中文: ~300 characters/min
    const wpm = language === 'en' ? 200 : 300;
    return Math.ceil(wordCount / wpm);
  }
}
```

---

### Task 3: WorkflowManager (src/core/workflow.ts)

**状态机 + Heartbeat + Stale Recovery：**

```typescript
import { v4 as uuidv4 } from 'uuid';
import { writeFile, readFile, readdir } from 'fs/promises';
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

export class WorkflowManager {
  private heartbeatTimer: Timer | null = null;
  private projectsDir: string;
  
  constructor(
    private geminiClient: GeminiClient,
    private trendsHook: TrendsHook,
    projectsDir: string = './active_projects'
  ) {
    this.projectsDir = projectsDir;
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
  
  async createProject(filePath: string, content: string, wordCount: number, readingTime: number): Promise<string> {
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
        word_count: wordCount,
        estimated_reading_time_minutes: readingTime
      },
      assets: {},
      meta: {
        stale_recovery_count: 0,
        model_used: 'gemini-3-pro',
        is_fallback_mode: false,
        cost: {
          total_tokens_used: 0,
          tokens_by_model: {
            'gemini-3-pro': 0,
            'gemini-3-flash': 0,
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
    if (!allowedTransitions.includes(newStatus)) {
      throw new Error(`Invalid state transition: ${currentStatus} -> ${newStatus}`);
    }
    
    manifest.status = newStatus;
    manifest.updated_at = new Date().toISOString();
    
    await this.saveManifest(projectId, manifest);
    
    logger.info('State transition', { projectId, from: currentStatus, to: newStatus });
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
      logger.error('Heartbeat check failed', { error });
    }
  }
  
  private async recoverStaleProject(projectId: string): Promise<void> {
    logger.warn('Recovering stale project', { projectId });
    
    const manifest = await this.loadManifest(projectId);
    manifest.status = 'stale_recovered';
    manifest.meta.stale_recovery_count += 1;
    manifest.updated_at = new Date().toISOString();
    
    await this.saveManifest(projectId, manifest);
    
    // 自动重新进入 pending
    await this.transitionState(projectId, 'pending');
  }
  
  private async loadManifest(projectId: string): Promise<ProjectManifest> {
    const path = join(this.projectsDir, projectId, 'manifest.json');
    const content = await readFile(path, 'utf-8');
    return ProjectManifestSchema.parse(JSON.parse(content));
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
```

---

### Task 4: Gemini MCP Client (src/agents/gemini-client.ts)

**连接池 + Warm-up + Token Bucket + Fallback + Prompt 简化：**

```typescript
import { createPool, Pool } from 'generic-pool';
import { TokenBucket } from '../infra/token-bucket';
import { PriorityQueue, Priority } from '../infra/priority-queue';
import { CostTracker } from '../utils/cost-tracker';
import { logger } from '../utils/logger';
import { withRetry } from '../utils/retry';

// Fallback 模型链
const MODEL_FALLBACK_CHAIN = [
  'gemini-3-pro',
  'gemini-3-flash',
  'gemini-2.5-flash'
] as const;

type ModelName = typeof MODEL_FALLBACK_CHAIN[number];

interface MCPConnection {
  send(prompt: string, model?: string): Promise<{ text: string; tokensUsed: number }>;
  close(): Promise<void>;
  isAlive(): boolean;
}

interface GenerateOptions {
  projectId: string;  // 必须，用于日志追踪
  priority?: Priority;
  maxRetries?: number;
  preferredModel?: ModelName;
}

interface GenerateResult {
  text: string;
  modelUsed: ModelName;
  isFallbackMode: boolean;
  tokensUsed: number;
}

export class GeminiClient {
  private pool: Pool<MCPConnection>;
  private tokenBucket: TokenBucket;
  private priorityQueue: PriorityQueue;
  private costTracker: CostTracker;
  private currentFallbackIndex = 0;
  
  constructor() {
    // Token Bucket: 60 requests per minute
    this.tokenBucket = new TokenBucket({
      maxTokens: 60,
      refillRate: 1
    });
    
    this.priorityQueue = new PriorityQueue();
    this.costTracker = new CostTracker();
    
    this.pool = createPool({
      create: async () => this.createConnection(),
      destroy: async (conn) => conn.close(),
      validate: async (conn) => conn.isAlive(),
      max: 5,
      min: 1,
      idleTimeoutMillis: 30_000,
      acquireTimeoutMillis: 10_000
    });
  }
  
  /**
   * Warm-up: 预建立连接，必须在 FolderWatcher 之前调用
   */
  async warmUp(): Promise<void> {
    logger.info('Warming up connection pool...');
    const conn = await this.pool.acquire();
    await this.pool.release(conn);
    logger.info('Connection pool warmed up successfully');
  }
  
  /**
   * 主生成方法 (含优先级队列 + Fallback)
   */
  async generate(prompt: string, options: GenerateOptions): Promise<GenerateResult> {
    const { projectId, priority = 'medium', maxRetries = 3 } = options;
    
    // 加入优先级队列等待
    await this.priorityQueue.enqueue(priority);
    
    try {
      // Rate limiting
      await this.tokenBucket.acquire();
      
      const conn = await this.pool.acquire();
      
      try {
        return await this.generateWithFallback(conn, prompt, projectId, maxRetries);
      } finally {
        await this.pool.release(conn);
      }
    } finally {
      this.priorityQueue.dequeue();
    }
  }
  
  /**
   * Fallback 链执行 + Prompt 简化
   */
  private async generateWithFallback(
    conn: MCPConnection,
    originalPrompt: string,
    projectId: string,
    retriesPerModel: number
  ): Promise<GenerateResult> {
    
    for (let modelIdx = 0; modelIdx < MODEL_FALLBACK_CHAIN.length; modelIdx++) {
      const model = MODEL_FALLBACK_CHAIN[modelIdx];
      const isFallbackMode = modelIdx > 0;
      
      // 如果是 Fallback 模式，简化 Prompt
      const prompt = isFallbackMode 
        ? this.simplifyPromptForFallback(originalPrompt)
        : originalPrompt;
      
      try {
        const result = await withRetry(
          () => conn.send(prompt, model),
          {
            maxRetries: retriesPerModel,
            baseDelayMs: 1000,
            onRetry: (attempt, error) => {
              logger.warn('Gemini retry', { 
                projectId, 
                model, 
                attempt, 
                error: error.message 
              });
            }
          }
        );
        
        // 记录成本
        this.costTracker.record(model, result.tokensUsed);
        
        logger.info('Gemini generation successful', {
          projectId,
          model,
          isFallbackMode,
          tokensUsed: result.tokensUsed
        });
        
        return {
          text: result.text,
          modelUsed: model,
          isFallbackMode,
          tokensUsed: result.tokensUsed
        };
        
      } catch (error) {
        const nextModel = MODEL_FALLBACK_CHAIN[modelIdx + 1];
        
        logger.error('Model failed', { 
          projectId,
          model, 
          nextModel: nextModel || 'NONE',
          error: (error as Error).message
        });
        
        if (modelIdx === MODEL_FALLBACK_CHAIN.length - 1) {
          throw new Error(`All models failed for project ${projectId}. Last error: ${error}`);
        }
      }
    }
    
    throw new Error('Unexpected: fallback chain exhausted');
  }
  
  /**
   * 简化 Prompt 用于 Fallback 模式
   * Flash 模型理解力较弱，需要更直白的指令
   */
  private simplifyPromptForFallback(prompt: string): string {
    // 移除复杂的隐喻和抽象描述
    // 添加更明确的输出格式要求
    const simplificationHeader = `
IMPORTANT: Please respond in a clear, straightforward manner.
- Use simple, direct language
- Follow the JSON format exactly as specified
- Do not use metaphors or abstract descriptions
- If unsure, provide your best attempt rather than asking for clarification

`;
    
    return simplificationHeader + prompt;
  }
  
  /**
   * 获取当前可用 token 数
   */
  getAvailableTokens(): number {
    return this.tokenBucket.getAvailableTokens();
  }
  
  /**
   * 获取成本报告
   */
  getCostReport(): CostTracker['report'] {
    return this.costTracker.getReport();
  }
  
  /**
   * 优雅关闭
   */
  async drain(): Promise<void> {
    await this.pool.drain();
    await this.pool.clear();
    logger.info('Connection pool drained');
  }
  
  private async createConnection(): Promise<MCPConnection> {
    // MCP 连接创建逻辑
    // 实际实现取决于 mcp-gateway 的协议
    throw new Error('Implement MCP connectcreation');
  }
}
```

---

### Task 5: Priority Queue (src/infra/priority-queue.ts)

**优先级队列：Token 不足时优先保证脚本产出**

```typescript
export type Priority = 'high' | 'medium' | 'low';

interface QueueItem {
  priority: Priority;
  resolve: () => void;
  enqueuedAt: number;
}

const PRIORITY_WEIGHTS: Record<Priority, number> = {
  high: 0,    // Script generation
  medium: 1,  // SEO generation
  low: 2      // Shorts extraction
};

export class PriorityQueue {
  private queue: QueItem[] = [];
  private processing = 0;
  private maxConcurrent = 5;
  
  async enqueue(priority: Priority): Promise<void> {
    if (this.processing < this.maxConcurrent) {
      this.processing++;
      return;
    }
    
    return new Promise((resolve) => {
      const item: QueueItem = {
        priority,
        resolve: () => {
          this.processing++;
          resolve();
        },
        enqueuedAt: Date.now()
      };
      
      // 按优先级插入
      const insertIndex = this.queue.fi     (existing) => PRIORITY_WEIGHTS[existing.priority] > PRIORITY_WEIGHTS[priority]
      );
      
      if (insertIndex === -1) {
        this.queue.push(item);
      } else {
        this.queue.splice(insertIndex, 0, item);
      }
    });
  }
  
  dequeue(): void {
    this.processing--;
    
    if (this.queue.length > 0) {
      const next = this.queue.shift()!;
      next.resolve();
    }
  }
  
  getQueueLength(): number {
    return this.queue.length;
  }
  
  getProcessingCount(): number {
    return this.processing;
  }
}
```

---

### Task 6: Trends Hook (src/agents/trends-hook.ts)

**Authority 分级 + Decay 衰减：**

```typescript
import { TrendKeyword } from '../core/manifest';
import { readFile, writeFile } from 'fs/promises';
import { logger } from '../utils/logger';

const CACHE_TTL_HOURS = 6;
const DECAY_THRESHOLD_HOURS = 24;
const PERSIST_PATH = './data/trends_authority.json';

const AUTHORITY_THRESHOLDS = {
  fleeting: 1,
  emerging: 2,
  established: 3
} as const;

interface TrendCach keyword: string;
  firstSeen: Date;
  lastSeen: Date;
  consecutiveWindows: number;
}

export class TrendsHook {
  private cache: Map<string, TrendCacheEntry> = new Map();
  
  constructor() {
    this.loadFromDisk();
  }
  
  async getHotKeywords(topic: string): Promise<TrendKeyword[]> {
    // Step 1: 应用衰减
    this.applyDecay();
    
    // Step 2: 从 API 获取新热词
    const rawKeywords = await this.fetchFromTrends(topic);
    
    // Step 3: 更新 Authority
    const enrichedKeywords = rds.map(kw => this.enrichWithAuthority(kw));
    
    // Step 4: 持久化
    await this.saveToDisk();
    
    // Step 5: 排序 (established > emerging > fleeting)
    return enrichedKeywords.sort((a, b) => {
      const order = { established: 0, emerging: 1, fleeting: 2 };
      return order[a.authority] - order[b.authority];
    });
  }
  
  /**
   * 应用衰减：24小时未出现的关键词降级
   */
  private applyDecay(): void {
    const now = Date.now();
    
    for (const [keyword, entry] ofe.entries()) {
      const hoursSinceLastSeen = (now - entry.lastSeen.getTime()) / (1000 * 60 * 60);
      
      if (hoursSinceLastSeen > DECAY_THRESHOLD_HOURS) {
        // 降级
        if (entry.consecutiveWindows > 1) {
          entry.consecutiveWindows -= 1;
          logger.info('Trend keyword decayed', { 
            keyword, 
            newWindows: entry.consecutiveWindows 
          });
        } else {
          // 完全移除
          this.cache.delete(keyword);
          logger.info('Trendoved (fully decayed)', { keyword });
        }
      }
    }
  }
  
  private enrichWithAuthority(keyword: string): TrendKeyword {
    const now = new Date();
    const existing = this.cache.get(keyword);
    
    if (existing) {
      const hoursSinceLastUpdate = 
        (now.getTime() - existing.lastSeen.getTime()) / (1000 * 60 * 60);
      
      if (hoursSinceLastUpdate >= CACHE_TTL_HOURS) {
        existing.consecutiveWindows += 1;
      }
      existing.lastSeen = now;
      
      this.cache.set(keyword, existing);
      
      const hoursSinceLastSeen = 
        (now.getTime() - existing.lastSeen.getTime()) / (1000 * 60 * 60);
      
      return {
        keyword,
        authority: this.calculateAuthority(existing.consecutiveWindows),
        consecutive_windows: existing.consecutiveWindows,
        first_seen: existing.firstSeen.toISOString(),
        last_seen: existing.lastSeen.toISOString(),
        decay_risk: hoursSinceLastSeen > DECAY_THRESHOLD_HOURS / 2
      };
    }
    
    // 新关键èst entry: TrendCacheEntry = {
      keyword,
      firstSeen: now,
      lastSeen: now,
      consecutiveWindows: 1
    };
    this.cache.set(keyword, entry);
    
    return {
      keyword,
      authority: 'fleeting',
      consecutive_windows: 1,
      first_seen: now.toISOString(),
      last_seen: now.toISOString(),
      decay_risk: false
    };
  }
  
  private calculateAuthority(windows: number): TrendKeyword['authority'] {
    if (windows >= AUTHORITY_THRESHOLDS.established) return 'established';
    if (windows >= AUTHORITY_THRESHOLDS.emerging) return 'emerging';
    return 'fleeting';
  }
  
  /**
   * 获取所有 established 关键词
   */
  getEstablishedKeywords(): string[] {
    return Array.from(this.cache.entries())
      .filter(([_, e]) => e.consecutiveWindows >= AUTHORITY_THRESHOLDS.established)
      .map(([keyword, _]) => keyword);
  }
  
  private async loadFromDisk(): Promise<void> {
    try {
      const content = await readFile(PERSIST_PATH, 'utf-8');
      const data = JSON.par     
      for (const [keyword, entry] of Object.entries(data)) {
        const e = entry as any;
        this.cache.set(keyword, {
          ...e,
          firstSeen: new Date(e.firstSeen),
          lastSeen: new Date(e.lastSeen)
        });
      }
      
      logger.info('Trends cache loaded', { count: this.cache.size });
    } catch {
      logger.info('No existing trends cache, starting fresh');
    }
  }
  
  private async saveToDisk(): Promise<void> {
    const data: Record<string, any> = {};
    
    for (const [keyword, entry] of this.cache.entries()) {
      data[keyword] = {
        ...entry,
        firstSeen: entry.firstSeen.toISOString(),
        lastSeen: entry.lastSeen.toISOString()
      };
    }
    
    await writeFile(PERSIST_PATH, JSON.stringify(data, null, 2));
  }
  
  private async fetchFromTrends(topic: string): Promise<string[]> {
    // 实际实现：调用 Google Trends API 或 SerpAPI
    throw new Error('Implement Google Trends API call');
  }
}
```

---

### Task 7: SEO Expert (src/agents/seo-expert.ts)

**双角色 + 强制热词覆盖验证：**

```typescript
import { SEOData, TrendKeyword, RegionalSEOSchema } from '../core/manifest';
import { GeminiClient } from './gemini-client';
import { TrendsHook } from './trends-hook';
import { logger } from '../utils/logger';

// 角色定义省略 (与之前版本相同)...

/**
 * 验证标题是否包含 established 热词
 */
function validateTrendCoverage(
  titles: string[], 
  establishedTrends: string[]
): { valid: boolean; gTrends: string[] } {
  if (establishedTrends.length === 0) {
    return { valid: true, missingTrends: [] };
  }
  
  const titlesLower = titles.map(t => t.toLowerCase()).join(' ');
  const missingTrends = establishedTrends.filter(
    trend => !titlesLower.includes(trend.toLowerCase())
  );
  
  return {
    valid: missingTrends.length === 0,
    missingTrends
  };
}

/**
 * 强制重生成包含热词的标题
 */
async function forceRegenerateTitlesWithTrends(
  geminiClient: GeminiClient,
  projectId: s coreFacts: string[],
  locale: string,
  persona: string,
  missingTrends: string[]
): Promise<string[]> {
  const forcePrompt = `
${persona}

You MUST include at least ONE of these trending keywords in your titles: ${missingTrends.join(', ')}

Based on these facts:
${coreFacts.join('\n')}

Generate 5 high-CTR titles that naturally incorporate the trending keywords.
Output as JSON: { "titles": string[] }
`;

  const result = await geminiClient.generate(forcePrompt, {
    projectId,
    priority: 'medium'
  });
  
  return JSON.parse(result.text).titles;
}

/**
 * SEO 生成主流程
 */
export async function generateMultiLangSEO(
  rawContent: string,
  projectId: string,
  geminiClient: GeminiClient,
  trendsHook: TrendsHook
): Promise<SEOData> {
  // Step 0: 获取热词 (含 Authority)
  const topic = await extractPrimaryTopic(rawContent, geminiClient, projectId);
  const allTrends = await trendsHook.getHotKeywords(topic);
  const establishedTrends = allTrends
    .filter(t => t.authority === 'established   .map(t => t.keyword);
  
  logger.info('Trends retrieved', { 
    projectId, 
    total: allTrends.length,
    established: establishedTrends.length 
  });
  
  // Step 1: 提取核心事实
  const analysisResult = await geminiClient.generate(
    CONTENT_ANALYST_PROMPT + '\n\nContent:\n' + rawContent,
    { projectId, priority: 'high' }
  );
  const { core_facts, key_entities } = JSON.parse(analysisResult.text);
  
  // Step 2: 并行生成各语言版本
  const regionalResults: RegionalSEOSchema[] = const [locale, persona] of Object.entries(REGIONAL_PERSONAS)) {
    const personalizedPersona = persona.replace(
      '{established_trends}',
      establishedTrends.join(', ') || 'none available'
    );
    
    let titles = await generateRegionalTitles(
      geminiClient, projectId, core_facts, locale, personalizedPersona
    );
    
    // 验证热词覆盖
    const validation = validateTrendCoverage(titles, establishedTrends);
    
    if (!validation.valid && establishedTrends.length > 0) {
      lTitles missing established trends, regenerating', {
        projectId,
        locale,
        missingTrends: validation.missingTrends
      });
      
      // 强制重生成
      titles = await forceRegenerateTitlesWithTrends(
        geminiClient, projectId, core_facts, locale, personalizedPersona, 
        validation.missingTrends
      );
    }
    
    const description = await generateRegionalDescription(
      geminiClient, projectId, core_facts, locale
    );
    
    regionalResults.push({
      locale as any,
      titles,
      description,
      cultural_hooks: extractCulturalHooks(description),
      contains_established_trend: validateTrendCoverage(titles, establishedTrends).valid
    });
  }
  
  // Step 3: 生成 FAQ
  const faq = await generateFAQ(geminiClient, projectId, core_facts);
  
  // Step 4: 生成章节
  const chapters = await generateSmartChapters(
    geminiClient, projectId, rawContent, establishedTrends
  );
  
  // 计算热词覆盖率
  const trendCoverageScore = calculatrageScore(regionalResults, establishedTrends);
  
  return {
    primary_language: detectLanguage(rawContent),
    tags: extractTags(core_facts, allTrends),
    chapters,
    regional_seo: regionalResults,
    faq_structured_data: faq,
    entities: key_entities,
    injected_trends: allTrends.slice(0, 5),
    trend_coverage_score: trendCoverageScore
  };
}

function calculateTrendCoverageScore(
  regionalResults: RegionalSEOSchema[],
  establishedTrends: string[]
): number {
  if (establishedTrends.length === 0) return 100;
  
  const coveredCount = regionalResults.filter(r => r.contains_established_trend).length;
  return Math.round((coveredCount / regionalResults.length) * 100);
}
```

---

### Task 8: Shorts Extractor (src/agents/shorts-extractor.ts)

**情绪弧度 + CTA 注入：**

```typescript
import { ShortsExtraction, ShortsHook, EmotionalTriggerSchema } from '../core/manifest';
import { GeminiClient } from './gemini-client';
import { logger } from '../utils/logger';

// CTA 模板 (根据情绪类_TEMPLATES: Record<string, string[]> = {
  anger: [
    '你怎么看？',
    '评论区说说你的想法',
    '你同意吗？',
    '这合理吗？'
  ],
  awe: [
    '太神了吧！',
    '分享给朋友看看',
    '收藏起来',
    '关注不迷路'
  ],
  curiosity: [
    '想知道结果吗？',
    '看到最后',
    '答案在评论区',
    '你猜对了吗？'
  ],
  fomo: [
    '别错过了！',
    '限时技巧',
    '90%的人不知道',
    '赶紧试试'
  ],
  validation: [
    '早该这样了',
    '终于有人说了',
    '双击认同'
  ]
};

const SHORTS_EXTRACTION_PROMPT = `
Analyze this video script and identify the 3-5 best moments for YouTube Shorts.

For EACH moment, analyze:

1. **Hook Type Classification:**
   - counter_intuitive: "Most people think X, but actually Y"
   - number_shock: "This saved me $10,000" or "In just 5 minutes"
   - controversy: Statements that spark debate
   - quick_tip: Immediately actionable advice

2. **Emotional Trigger (CRITICAL for viraliger: Makes viewers want to comment/argue → HIGH comment rate
   - awe: Creates wonder/amazement → HIGH share rate
   - curiosity: Leaves them wanting more → HIGH completion rate
   - fomo: Fear of missing out → HIGH click rate
   - validation: Makes them feel smart/right → HIGH like rate

3. **Visual Focus:**
   - If the segment features a speaker, mark face_detection_required: true
   - If it's a screen recording or diagram, use 'center' or 'dynamic'

Output as JSON:
{
  "hooks": [
    {
      "ting (max 50 chars for overlay)",
      "timestamp_start": "MM:SS",
      "timestamp_end": "MM:SS",
      "hook_type": "counter_intuitive|number_shock|controversy|quick_tip",
      "emotional_trigger": "anger|awe|curiosity|fomo|validation",
      "controversy_score": 0-10,
      "predicted_engagement": {
        "comments": "low|medium|high",
        "shares": "low|medium|high",
        "completion_rate": "low|medium|high"
      },
      "face_detection_required": boolean
    }
  ],
  "vertical_crop_focus": "center|left|right|speaker|dynamic",
  "recommended_music_mood": "upbeat|dramatic|chill|none"
}
`;

/**
 * 注入 CTA
 */
function injectCTA(hook: ShortsHook): ShortsHook {
  const templates = CTA_TEMPLATES[hook.emotional_trigger];
  if (!templates) return hook;
  
  // 随机选择一个 CTA
  const cta = templates[Math.floor(Math.random() * templates.length)];
  
  return {
    ...hook,
    injected_cta: cta
  };
}

/**
 * 提取 Shorts hooks
 */
export async function extractShortsHooks(
  script: ScriptSnt[],
  projectId: string,
  geminiClient: GeminiClient
): Promise<ShortsExtraction> {
  const fullScript = script
    .map(s => `[${s.timestamp}] ${s.voiceover}`)
    .join('\n');
  
  const result = await geminiClient.generate(
    SHORTS_EXTRACTION_PROMPT + '\n\nScript:\n' + fullScript,
    { projectId, priority: 'low' }
  );
  
  const parsed = JSON.parse(result.text);
  
  // 注入 CTA
  const hooksWithCTA = parsed.hooks.map((hook: ShortsHook) => injectCTA(hook));
  
  // 排序：优先高情绪触åWithCTA.sort((a: ShortsHook, b: ShortsHook) => {
    const priority = { anger: 0, awe: 1, fomo: 2, curiosity: 3, validation: 4 };
    return priority[a.emotional_trigger] - priority[b.emotional_trigger];
  });
  
  // 确定是否需要人脸检测
  const needsFaceDetection = hooksWithCTA.some(
    (h: any) => h.face_detection_required || h.hook_type === 'controversy'
  );
  
  logger.info('Shorts hooks extracted', {
    projectId,
    count: hooksWithCTA.length,
    topEmotion: hooksWithCTA[0]?.emotionalgger,
    needsFaceDetection
  });
  
  return {
    hooks: hooksWithCTA,
    vertical_crop_focus: parsed.vertical_crop_focus,
    recommended_music_mood: parsed.recommended_music_mood,
    face_detection_hint: needsFaceDetection
  };
}
```

---

### Task 9: Cost Tracker (src/utils/cost-tracker.ts)

**Token 使用量追踪：**

```typescript
import { writeFile, readFile } from 'fs/promises';
import { CostTracking } from '../core/manifest';

// 2026 估算价格 (per 1M tokens)
const TOKEN_PRICES_USD: Recorring, number> = {
  'gemini-3-pro': 3.50,
  'gemini-3-flash': 0.35,
  'gemini-2.5-flash': 0.10
};

const PERSIST_PATH = './data/cost_report.json';

export class CostTracker {
  private data: CostTracking = {
    total_tokens_used: 0,
    tokens_by_model: {
      'gemini-3-pro': 0,
      'gemini-3-flash': 0,
      'gemini-2.5-flash': 0
    },
    estimated_cost_usd: 0,
    api_calls_count: 0
  };
  
  constructor() {
    this.loadFromDisk();
  }
  
  record(model: string, tokens: number): void {
    this.data.total_tokens_used += tokens;
    this.data.api_calls_count += 1;
    
    if (model in this.data.tokens_by_model) {
      this.data.tokens_by_model[model as keyof typeof this.data.tokens_by_model] += tokens;
    }
    
    // 计算成本
    const price = TOKEN_PRICES_USD[model] || 0;
    this.data.estimated_cost_usd += (tokens / 1_000_000) * price;
    
    // 异步保存
    this.saveToDisk().catch(() => {});
  }
  
  getReport(): CostTracking {
    return { ...this.data };
  }
  
  getForProject(): CostTracking {
    // 返回可用于单个项目的成本结构
    return {
      total_tokens_used: 0,
      tokens_by_model: {
        'gemini-3-pro': 0,
        'gemini-3-flash': 0,
        'gemini-2.5-flash': 0
      },
      estimated_cost_usd: 0,
      api_calls_count: 0
    };
  }
  
  private async loadFromDisk(): Promise<void> {
    try {
      const content = await readFile(PERSIST_PATH, 'utf-8');
      this.data = JSON.parse(content);
    } catch {
      // 使用默认值
    }
  }
rivate async saveToDisk(): Promise<void> {
    await writeFile(PERSIST_PATH, JSON.stringify(this.data, null, 2));
  }
}
```

---

### Task 10: Structured Logger (src/utils/logger.ts)

**结构化日志 (必须含 project_id)：**

```typescript
type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  projectId?: string;
  [key: string]: unknown;
}

class Logger {
  private minLevel: LogLevel = 'info';
  
  private levelPriority: cord<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3
  };
  
  setLevel(level: LogLevel): void {
    this.minLevel = level;
  }
  
  private log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    if (this.levelPriority[level] < this.levelPriority[this.minLevel]) {
      return;
    }
    
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...context
    };
    
    // 确保 projectId 总是在æ { projectId, ...rest } = entry;
    const output = projectId 
      ? { timestamp: entry.timestamp, level, projectId, message, ...rest }
      : entry;
    
    const line = JSON.stringify(output);
    
    if (level === 'error') {
      console.error(line);
    } else {
      console.log(line);
    }
  }
  
  debug(message: string, context?: Record<string, unknown>): void {
    this.log('debug', message, context);
  }
  
  info(message: string, context?: Record<string, unknown>): void {
    this.log('info', message, context);
  }
  
  warn(message: string, context?: Record<string, unknown>): void {
    this.log('warn', message, context);
  }
  
  error(message: string, context?: Record<string, unknown>): void {
    this.log('error', message, context);
  }
}

export const logger = new Logger();
```

---

## 🚀 Entry Point (src/index.ts)

**严格的启动顺序：**

```typescript
import { FolderWatcher } from './core/watcher';
import { WorkflowManager } from './core/workflow';
import { GeminiClient } fro'./agents/gemini-client';
import { TrendsHook } from './agents/trends-hook';
import { logger } from './utils/logger';

async function main() {
  logger.info('🚀 YT-Factory Orchestrator starting...');
  
  // ============================================
  // Step 1: 初始化组件
  // ============================================
  const geminiClient = new GeminiClient();
  const trendsHook = new TrendsHook();
  const workflowManager = new WorkflowManager(geminiClient, trendsHook);
  
  // ==================================
  // Step 2: CRITICAL - Warm-up 必须在 Watcher 之前
  // ============================================
  logger.info('Warming up connections (this may take a few seconds)...');
  await geminiClient.warmUp();
  logger.info('✅ Connection pool ready');
  
  // ============================================
  // Step 3: 启动 Heartbeat
  // ============================================
  workflowManager.startHeartbeat();
  logger.info('💓 Heartbeat started');
  
  // ==========================================
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
          metadata.estimatedReadingTimeMinutes
           
        logger.info('Project queued for processing', { 
          projectId,
          wordCount: metadata.wordCount,
          language: metadata.detectedLanguage
        });
        
        // 触发处理流程
        await workflowManager.processProject(projectId);
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
  logger.info('👀 Watching ./incomiles');
  
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
    logger.info(`Received ${signal}, shutt gracefully...`);
    
    await watcher.stop();
    workflowManager.stopHeartbeat();
    await geminiClient.drain();
    
    // 打印最终成本报告
    const costReport = geminiClient.getCostReport();
    logger.info('Final cost report', costReport);
    
    logger.info('👋 Shutdown complete');
    process.exit(0);
  };
  
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  
  process.on('unhandledRejection', (reason, promise) => {
    logger.err('Unhandled Rejection', { 
      reason: String(reason),
      promise: String(promise)
    });
  });
}

main().catch((error) => {
  logger.error('Fatal error during startup', { error: error.message });
  process.exit(1);
});
```

---

## ✅ Definition of Done

### Core Functionality
- [ ] `bun run dev` 启动，Warm-up 在 Watcher 之前完成
- [ ] Token Bucket 平滑 API 请求 (60/min)
- [ ] Priority Queue 保证脚本生成优先
- [ ] Gemini 失败时自动 Fallback + Prompt 简化

### SEO & Content词 Authority 分级 + 24h Decay
- [ ] 标题强制包含 established 热词 (自动重生成)
- [ ] FAQ 含 related_entities
- [ ] trend_coverage_score 计算正确

### Shorts
- [ ] 情绪弧度分析 (anger/awe/curiosity/fomo/validation)
- [ ] CTA 自动注入 (根据情绪类型)
- [ ] face_detection_hint 正确标记

### Observability
- [ ] 每行日志都有 project_id
- [ ] Cost tracking 记录 token 使用量
- [ ] Shutdown 时打印成本报告

### Stability
- [ ] Stale 项目 10 分钟后自动æ] 错误记录 fallback_model_used
- [ ] Graceful shutdown 无资源泄漏

---

## 🎯 最终检查清单 (发布前)

### 热词 SEO
- [ ] established 热词覆盖率 > 80%？
- [ ] decay_risk 关键词是否已处理？
- [ ] 标题是否真正"本地化"而非翻译？

### Shorts 病毒性
- [ ] 至少 1 个 anger/awe 情绪触发？
- [ ] controversy_score > 5？
- [ ] CTA 与情绪类型匹配？

### 成本控制
- [ ] 过去 24h Fallback 率 < 20%？
- [ ] Token 使用量符合预期？
- [ ] é
### 系统健康
- [ ] Warm-up 成功？
- [ ] Heartbeat 正常运行？
- [ ] 无 unhandled rejection？

### NotebookLM Audio Support
- [ ] NotebookLM 脚本正确生成 (EN + ZH)？
- [ ] pending_audio 状态转换正常？
- [ ] 音频文件检测 (heartbeat) 工作正常？
- [ ] 音频时长正确提取？

---

## 🎙️ NotebookLM Audio Support (Jan 2026)

### Overview

NotebookLM Audio Support 允许使用 Google NotebookLM 生成高质量的"极客禅"播客音频，作为视频渲染的音源。

**工作流程：**
```
orchestrator → NotebookLM scripts → 手动上传到 NotebookLM → 下载音频 → 自动检测 → video-renderer
```

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                  NotebookLM Audio Workflow                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  [orchestrator]                                                  │
│       │                                                          │
│       ├─ Stage 7: NotebookLM Script Generation                  │
│       │     └─ Generates: notebooklm_script_en.md               │
│       │                   notebooklm_script_zh.md               │
│       │                                                          │
│       ├─ Status: analyzing → pending_audio                      │
│       │                                                          │
│       └─ Heartbeat (60s interval)                               │
│             └─ Monitors: active_projects/{id}/audio/*.mp3       │
│                                                                  │
│  [User Manual Step]                                              │
│       1. Copy script to NotebookLM (notebooklm.google.com)      │
│       2. Generate "Audio Overview"                               │
│       3. Download MP3 to: active_projects/{id}/audio/en.mp3     │
│                                                                  │
│  [orchestrator heartbeat detects audio]                         │
│       └─ Updates manifest: audio_status: pending → ready        │
│       └─ Extracts duration via ffprobe                          │
│       └─ Prints render instructions                             │
│                                                                  │
│  [video-renderer]                                                │
│       └─ Validates audio (codec, duration)                      │
│       └─ Renders video synced to audio                          │
│       └─ Updates status: pending_audio → rendering              │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Manifest Schema Extensions

```typescript
// Audio Language Configuration
export const AudioLanguageConfigSchema = z.object({
  script_path: z.string(),           // e.g., "notebooklm_script_en.md"
  audio_path: z.string(),            // e.g., "audio/en.mp3"
  audio_status: z.enum(['pending', 'ready']),
  duration_seconds: z.number().nullable()
});

// NotebookLM Audio Configuration
export const NotebookLMAudioConfigSchema = z.object({
  source: z.literal('notebooklm'),
  languages: z.object({
    en: AudioLanguageConfigSchema.optional(),
    zh: AudioLanguageConfigSchema.optional()
  })
});

// NotebookLM Script Metadata
export const NotebookLMScriptMetadataSchema = z.object({
  title: z.string(),
  bug_report: z.string(),
  root_cause: z.string(),
  hotfix: z.string(),
  estimated_duration_minutes: z.number(),
  shorts_count: z.number(),
  generated_at: z.string().datetime()
});
```

### Processing Pipeline (9 Stages)

| Stage | Name | Description |
|-------|------|-------------|
| 1 | INIT | Initialize project, transition to analyzing |
| 2 | SCRIPT_GENERATION | Generate video script segments |
| 3 | TREND_ANALYSIS | Fetch and analyze trending keywords |
| 4 | SEO_GENERATION | Generate multi-language SEO metadata |
| 5 | SHORTS_EXTRACTION | Extract viral hooks with emotional triggers |
| 6 | VOICE_MATCHING | Match voice persona to content |
| 7 | **NOTEBOOKLM_GENERATION** | Generate bilingual podcast scripts |
| 8 | MANIFEST_UPDATE | Persist all results to manifest |
| 9 | FINALIZATION | Transition to pending_audio, print instructions |

### State Machine

```
pending → analyzing → pending_audio → rendering → uploading → completed
                ↑         │
                └─────────┘ (stale recovery)
```

**New State: `pending_audio`**
- Entered after content engine processing completes
- Heartbeat monitors for audio file uploads
- Transitions to `rendering` when video-renderer is invoked

### "Geek Zen" Podcast Format

NotebookLM scripts follow the "极客禅" (Geek Zen) format:

**Characters:**
- **The Architect**: Senior engineer (20+ years), calm and authoritative
- **The Dev (小王)**: Mid-level engineer, anxious but curious

**Structure:**
- Act 1: System Alert (2-3 min) - Bug report as human struggle
- Act 2: Root Cause Analysis (4-5 min) - Technical analogy
- Act 3: The Koan / Hotfix (3-4 min) - Zen insight as code fix
- Act 4: Deployment (2-3 min) - Practical application

**Concept Mapping:**
| Life Concept | Tech Equivalent |
|--------------|-----------------|
| Attachment | Memory Leak |
| Anxiety | Polling Loop |
| Letting Go | Garbage Collection |
| Enlightenment | Kernel Upgrade |

### Key Files

| File | Purpose |
|------|---------|
| `src/agents/notebooklm-generator.ts` | Script generation with bilingual prompts |
| `src/core/manifest.ts` | Audio config schemas |
| `src/core/workflow.ts` | Audio detection via heartbeat |
| `src/core/processing-stages.ts` | NOTEBOOKLM_GENERATION stage |

### Usage

**1. Run Orchestrator:**
```bash
bun run start
# Drop markdown file into ./incoming/
# Wait for processing to complete (status: pending_audio)
```

**2. Generate Audio Manually:**
```bash
# Open generated scripts:
cat active_projects/{project-id}/notebooklm_script_en.md
cat active_projects/{project-id}/notebooklm_script_zh.md

# Upload to NotebookLM and generate audio
# Download MP3 files to:
#   active_projects/{project-id}/audio/en.mp3
#   active_projects/{project-id}/audio/zh.mp3
```

**3. Render Video:**
```bash
cd ../video-renderer
node render.mjs {project-id} --lang=en
node render.mjs {project-id} --lang=zh
```

### Audio Validation (video-renderer)

The video-renderer validates audio files before rendering:
- **File existence**: Must exist and be non-empty
- **Minimum size**: > 1KB (corrupted file check)
- **Duration**: 5 seconds to 2 hours
- **Codec**: mp3, aac, opus, vorbis, flac supported
- **Detection**: Uses ffprobe for Node.js compatibility

---

## 📚 Session Learnings (Jan 2026)

### Commit History Summary

| Commit | Description |
|--------|-------------|
| `050157e` | Part 2 orchestrator modules + Gemini 3 series upgrade (20 files, +2,885 lines) |
| `c527c50` | README project architecture documentation |
| `ff5d41e` | Initial implementation (24 files, +4,344 lines) |
| `58fbb6c` | Repository initialization |

### Gemini 3 Model Migration

**Model Fallback Chain (2026):**
```
gemini-3-pro (3x) → gemini-3-flash (3x) → gemini-2.5-flash (3x)
```

**Token Pricing (per 1M tokens):**
| Model | Price USD |
|-------|-----------|
| gemini-3-pro | $5.00 |
| gemini-3-flash | $0.50 |
| gemini-2.5-flash | $0.15 |

**Files Updated for Migration:**
- `src/agents/gemini-client.ts` - MODEL_FALLBACK_CHAIN
- `src/core/manifest.ts` - CostTrackingSchema defaults
- `src/core/workflow.ts` - Project creation defaults
- `src/utils/cost-tracker.ts` - TOKEN_PRICES_USD + getForProject()

### Part 2 Modules Implemented

| Module | Purpose | Key Features |
|--------|---------|--------------|
| `originality-checker.ts` | Content duplication prevention | 3-layer validation: visual 80%, semantic 70%, style fingerprinting |
| `emotion-extractor.ts` | Viral Shorts identification | 4-stage pipeline for 7 emotion types, viral potential scoring |
| `faq-generator.ts` | Google AI Overview optimization | 6 AIO patterns + Schema.org JSON-LD markup |
| `regional-optimizer.ts` | Global market targeting | 6 regions with CPM-based prioritization ($4-$15) |
| `seasonal-planner.ts` | Revenue-aware scheduling | Quarterly strategies, Q4 peak events (2.5x CPM) |
| `monetization-optimizer.ts` | Ad suitability pre-scoring | 5-dimension risk analysis, brand-safe keyword replacement |
| `aio-feedback-loop.ts` | Citation performance learning | ML from AIO citations with persistent storage |

### TypeScript Strict Mode Patterns

**Gotcha #1: Zod v3 z.record() requires two parameters**
```typescript
// ❌ Wrong - only value type
z.record(z.unknown())

// ✅ Correct - key type and value type
z.record(z.string(), z.unknown())
```

**Gotcha #2: Nested Zod defaults need complete structure**
```typescript
// ❌ Wrong - empty object default
tokens_by_model: z.object({
  'gemini-3-pro': z.number().default(0),
  'gemini-3-flash': z.number().default(0),
}).default({})

// ✅ Correct - complete default object
tokens_by_model: z.object({
  'gemini-3-pro': z.number().default(0),
  'gemini-3-flash': z.number().default(0),
}).default({
  'gemini-3-pro': 0,
  'gemini-3-flash': 0,
})
```

**Gotcha #3: Null safety for array indexing with noUncheckedIndexedAccess**
```typescript
// ❌ Wrong - array[index] returns T | undefined
const topic = topics[topicIndex];
processTopic(topic); // Error: string | undefined not assignable to string

// ✅ Correct - nullish coalescing fallback
const topic = topics[topicIndex] ?? '';
processTopic(topic);

// ✅ Also correct - double fallback for nested lookups
const angle = SEASONAL_ANGLES[quarter]?.[contentType] ?? SEASONAL_ANGLES[quarter]?.default ?? '';
```

**Gotcha #4: Chokidar FSWatcher type import**
```typescript
// ❌ Wrong - using namespace
private watcher: chokidar.FSWatcher | null = null;

// ✅ Correct - import type directly
import type { FSWatcher } from 'chokidar';
private watcher: FSWatcher | null = null;
```

**Gotcha #5: Explicit event handler types**
```typescript
// ❌ Wrong - untyped parameters
this.watcher.on('error', (error) => { ... });

// ✅ Correct - explicit Error type
this.watcher.on('error', (error: Error) => { ... });
```

### Error Resolution Summary

Total errors fixed in Part 2 session: **22**

| Category | Count | Fix Pattern |
|----------|-------|-------------|
| Zod schema defaults | 4 | Complete nested default objects |
| Null safety (seasonal-planner) | 5 | Nullish coalescing for array access |
| Null safety (regional-optimizer) | 2 | Empty array fallbacks for lookups |
| Null safety (emotion-extractor) | 5 | Null guards + CTA option fallbacks |
| Chokidar types (watcher.ts) | 3 | Direct type imports + explicit annotations |
| Logger properties (logger.ts) | 3 | Explicit destructuring to avoid duplication |

### Architecture Update: Direct Gemini SDK (Jan 29, 2026)

**Problem:** Original design routed text generation through MCP gateway, but:
1. MCP gateway (`mcp-gateway/`) is specialized for YouTube/Trends API operations
2. Gateway doesn't have a `generate` tool for raw text generation
3. Orchestrator hung on startup trying to connect to non-existent MCP tool

**Solution:** Gemini client now uses `@google/generative-ai` SDK directly:
```
Before: [orchestrator] → MCP → [mcp-gateway] → Gemini API
After:  [orchestrator] → @google/generative-ai SDK → Gemini API
        [orchestrator] → MCP → [mcp-gateway] → YouTube/Trends APIs (separate)
```

**Key Changes:**
- `src/agents/gemini-client.ts` - Rewritten to use GoogleGenerativeAI SDK
- `src/index.ts` - Added `import 'dotenv/config'` for environment loading
- `.env` - Added `GEMINI_API_KEY` variable
- `package.json` - Added `@google/generative-ai` dependency

**Startup Flow Fix:**
1. `dotenv/config` loads environment variables at startup
2. GeminiClient initializes with API key from `GEMINI_API_KEY`
3. `warmUp()` initializes all models in fallback chain
4. Mock mode (`MOCK_MODE=true`) available for development without API key

**Gotcha #6: trends-hook.ts null safety**
```typescript
// ❌ Wrong - parsed.keywords could be undefined
const parsed = JSON.parse(result.text);
return parsed.keywords as string[];

// ✅ Correct - validate array before returning
const keywords = parsed.keywords;
if (!Array.isArray(keywords)) {
  logger.warn('Trends response missing keywords array', { projectId });
  return [];
}
return keywords as string[];
```

### Code Quality Review & Fixes (Jan 31, 2026)

Comprehensive code review identified and fixed 9 issues across orchestrator and mcp-gateway:

#### Orchestrator Fixes

| File | Issue | Fix |
|------|-------|-----|
| `src/utils/retry.ts` | TypeScript error - function lacked ending return statement | Added documented throw statement for TypeScript flow analysis |
| `src/core/workflow.ts` | console.log in `printRenderInstructions` | Replaced with structured `logger.info` call |
| `src/core/workflow.ts` | No error handling in `loadManifest` | Added try/catch with specific error types (SyntaxError, ENOENT) |
| `src/core/workflow.ts` | No error handling in `saveManifest` | Added try/catch with error logging and re-throw |
| `src/core/workflow.ts` | Hardcoded configuration values | Made configurable via environment variables |
| `src/agents/notebooklm-generator.ts` | console.log in `printNextSteps` | Replaced with structured `logger.info` call |
| `src/agents/gemini-client.ts` | Hardcoded rate limit | Made configurable via `GEMINI_RATE_LIMIT_RPM` |

#### MCP Gateway Fixes

| File | Issue | Fix |
|------|-------|-----|
| `src/config.py` | No validation for required credentials | Added `_get_required_env`, `_get_optional_env` helpers and `validate_config()` |

#### New Environment Variables

```bash
# Workflow thresholds (all in milliseconds)
STALE_THRESHOLD_ANALYZING_MS=600000    # 10 min default
STALE_THRESHOLD_RENDERING_MS=1800000   # 30 min default
STALE_THRESHOLD_UPLOADING_MS=300000    # 5 min default
STALE_THRESHOLD_DEGRADED_MS=900000     # 15 min default

# Heartbeat and retry
HEARTBEAT_INTERVAL_MS=60000            # 1 min default
MAX_STALE_RECOVERY_COUNT=3
MAX_RETRIES=3

# Directories
DEAD_LETTER_DIR=./dead-letter
ALERTS_DIR=./logs/alerts

# Rate limiting
GEMINI_RATE_LIMIT_RPM=60               # Requests per minute
```

**Gotcha #7: TypeScript flow analysis for exhaustive loops**
```typescript
// ❌ Wrong - TypeScript thinks loop might exit without returning
for (let attempt = 1; attempt <= maxRetries; attempt++) {
  try {
    return await fn();
  } catch (error) {
    if (attempt === maxRetries) throw error;
    await delay();
  }
}
// TypeScript error: Function lacks ending return statement

// ✅ Correct - Add documented unreachable throw
for (let attempt = 1; attempt <= maxRetries; attempt++) {
  try {
    return await fn();
  } catch (error) {
    if (attempt === maxRetries) throw error;
    await delay();
  }
}
// TypeScript flow analysis requires this even though unreachable
throw new Error('Retry loop exhausted unexpectedly');
```

### Critical Bug Fixes (Feb 2, 2026)

Comprehensive code review identified and fixed 6 critical bugs across orchestrator and mcp-gateway:

#### Orchestrator Fixes

| File | Issue | Fix |
|------|-------|-----|
| `src/utils/cost-tracker.ts` | Silent error suppression in disk save | Added error logging to `.catch()` handler |
| `src/core/file-hash-manager.ts` | Race condition in `init()` when called concurrently | Added promise-based locking pattern with `initPromise` |
| `src/agents/gemini-client.ts` | No timeout on Gemini API calls - could hang indefinitely | Added `Promise.race()` with configurable timeout |

#### New Environment Variable

```bash
# Gemini API timeout (milliseconds)
GEMINI_API_TIMEOUT_MS=120000           # 2 min default
```

**Gotcha #8: Promise.race() for API timeouts**
```typescript
// ❌ Wrong - no timeout protection
const result = await model.generateContent(prompt);

// ✅ Correct - timeout with Promise.race()
const timeoutMs = parseInt(process.env.GEMINI_API_TIMEOUT_MS ?? '120000', 10);
const timeoutPromise = new Promise<never>((_, reject) => {
  setTimeout(() => reject(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs);
});
const result = await Promise.race([model.generateContent(prompt), timeoutPromise]);
```

**Gotcha #9: Promise-based locking for concurrent initialization**
```typescript
// ❌ Wrong - race condition when init() called concurrently
async init(): Promise<void> {
  if (this.initialized) return;
  // ... initialization logic
  this.initialized = true;
}

// ✅ Correct - promise-based lock
private initPromise: Promise<void> | null = null;

async init(): Promise<void> {
  if (this.initialized) return;
  if (this.initPromise) return this.initPromise;
  this.initPromise = this._doInit();
  try {
    await this.initPromise;
  } finally {
    this.initPromise = null;
  }
}
```

