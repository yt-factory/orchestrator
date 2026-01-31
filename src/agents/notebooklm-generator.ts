/**
 * NotebookLM Script Generator
 *
 * Generates conversational podcast scripts optimized for Google NotebookLM
 * audio generation. Produces "Geek Zen" style scripts that debug the human
 * condition using software engineering metaphors.
 */

import { GeminiClient } from './gemini-client';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { logger } from '../utils/logger';
import { safeJsonParse } from '../utils/json-parse';
import type { NotebookLMAudioConfig, AudioLanguageConfig } from '../core/manifest';

// Re-export types for consumers
export type { NotebookLMAudioConfig, AudioLanguageConfig } from '../core/manifest';

// ============================================
// Types
// ============================================

export interface NotebookLMScriptConfig {
  projectId: string;
  projectDir: string;
  rawContent: string;
  languages: ('en' | 'zh')[];
}

export interface GeneratedScript {
  language: 'en' | 'zh';
  content: string;
  filepath: string;
  metadata: {
    estimatedDurationMinutes: number;
    shortsCount: number;
    bugReport: string;
    rootCause: string;
    hotfix: string;
  };
}

// ============================================
// Prompt Templates
// ============================================

const EN_PROMPT_TEMPLATE = `[System Context: Internal Developer Documentation - Philosophy Module]
[Subject: Human OS Kernel Debugging]
[Tone: Philosophical, Tech-Savvy, Analytical, Grounded - NOT Cheerful]
[Target Audience: Senior Engineers experiencing burnout and existential debugging]

---

# Geek Zen Podcast Script Generator

## Source Material
{raw_content}

---

## Instructions

You are creating a 10-15 minute podcast script for "Geek Zen" - a show that debugs the human condition using software engineering metaphors.

### Character Profiles

**The Architect (Host 1)**
- Role: Senior Staff Engineer / Tech Lead with 20+ years experience
- Personality: Calm, authoritative, sees everything as systems and code
- Speaking style: Precise, uses technical metaphors naturally
- Technical vocabulary: kernel panic, memory leak, race condition, legacy code, technical debt, polling, callbacks, async/await

**The Dev (Host 2 - "Xiao Wang")**
- Role: Mid-level engineer, 3-5 years experience
- Personality: Anxious, overthinking, prone to burnout, but genuinely curious
- Speaking style: Self-deprecating humor, asks questions that seem simple but are actually profound
- Represents: The listener's inner struggles

### Dialogue Structure

**Act 1: System Alert (2-3 min)** - Relatable tech/life struggle as "bug report"
**Act 2: Root Cause Analysis (4-5 min)** - Reframe as system architecture issue with technical analogies
**Act 3: The Koan / Hotfix (3-4 min)** - Present core Zen insight as "the fix"
**Act 4: Deployment (2-3 min)** - Practical application, actionable insight

### Style Guidelines
1. Technical metaphors are MANDATORY - Every spiritual concept must have a code equivalent
2. Conversational, not scripted - Include natural speech patterns like "um", "you know"
3. Grounded cynicism with genuine hope - NO new-age fluff
4. Map concepts: Attachment→Memory Leak, Anxiety→Polling Loop, Letting Go→Garbage Collection, Enlightenment→Kernel Upgrade

### Output Format (JSON)

{
  "metadata": {
    "title": "Episode title with tech metaphor",
    "bug_report": "One-line description of the human condition being debugged",
    "root_cause": "The delusion/attachment causing the bug",
    "hotfix": "The Zen insight as a code fix",
    "estimated_duration_minutes": 12
  },
  "transcript": [
    { "speaker": "The Dev", "text": "dialogue line" },
    { "speaker": "The Architect", "text": "dialogue line" },
    ...
  ],
  "shorts": [
    { "quote": "Quotable line for 60-sec Short", "act": 2 },
    { "quote": "Another quotable", "act": 3 },
    { "quote": "Another quotable", "act": 4 }
  ],
  "glossary": [
    { "term": "Technical term", "tech_definition": "What it means in code", "life_application": "What it means for life" }
  ]
}`;

const ZH_PROMPT_TEMPLATE = `[System Context: 技术团队内部分享 - 哲学模块]
[Subject: 人类操作系统内核调试]
[Tone: 深度思考、技术范、分析性、接地气 - 不要过于欢快]
[Target Audience: 正在经历职业倦怠的资深工程师]

---

# 极客禅播客脚本生成器

## 原始素材
{raw_content}

---

## 生成指令

你正在为「极客禅」创作一期 10-15 分钟的播客脚本。用软件工程隐喻 debug 人生困境。

### 角色设定

**架构师（主持人 1）**
- 20 年经验的资深架构师，冷静透彻
- 说话精准，自然使用技术隐喻
- 技术词汇：内核崩溃、内存泄漏、竞态条件、技术债、轮询、回调、异步

**小王（主持人 2）**
- 3-5 年经验的中级工程师，焦虑但好奇
- 自嘲式幽默，会说"诶"、"那个"、"嗯..."
- 代表听众内心的挣扎

### 对话结构

**第一幕：系统告警（2-3 分钟）** - 小王描述 relatable 的困境
**第二幕：根因分析（4-5 分钟）** - 架构师用技术类比解释
**第三幕：公案 / Hotfix（3-4 分钟）** - 呈现禅学洞见
**第四幕：部署上线（2-3 分钟）** - 可执行的实际应用

### 风格指南
1. 技术隐喻是强制的 - 执着→内存泄漏，焦虑→轮询循环，放下→垃圾回收
2. 口语化 - 包含自然的停顿和语气词
3. 接地气的犀利 - 不要心灵鸡汤

### 输出格式 (JSON)

{
  "metadata": {
    "title": "本期标题（基于技术隐喻）",
    "bug_report": "一句话描述正在 debug 的人类困境",
    "root_cause": "导致问题的执念",
    "hotfix": "禅学洞见",
    "estimated_duration_minutes": 12
  },
  "transcript": [
    { "speaker": "小王", "text": "台词" },
    { "speaker": "架构师", "text": "台词" },
    ...
  ],
  "shorts": [
    { "quote": "金句1", "act": 2 },
    { "quote": "金句2", "act": 3 },
    { "quote": "金句3", "act": 4 }
  ],
  "glossary": [
    { "term": "术语", "tech_definition": "技术定义", "life_application": "人生应用" }
  ]
}`;

// ============================================
// Script Generation
// ============================================

interface ScriptResponse {
  metadata: {
    title: string;
    bug_report: string;
    root_cause: string;
    hotfix: string;
    estimated_duration_minutes: number;
  };
  transcript: Array<{ speaker: string; text: string }>;
  shorts: Array<{ quote: string; act: number }>;
  glossary: Array<{ term: string; tech_definition: string; life_application: string }>;
}

/**
 * Convert JSON response to readable Markdown script
 */
function formatScriptAsMarkdown(data: ScriptResponse, language: 'en' | 'zh'): string {
  const isZh = language === 'zh';
  const lines: string[] = [];

  // Header
  lines.push(`# ${isZh ? '极客禅' : 'Geek Zen'}: ${data.metadata.title}`);
  lines.push('');

  // Metadata section
  lines.push(`## ${isZh ? '本期元数据' : 'Episode Metadata'}`);
  lines.push(`- **${isZh ? 'Bug 报告' : 'Bug Report'}**: ${data.metadata.bug_report}`);
  lines.push(`- **${isZh ? '根因' : 'Root Cause'}**: ${data.metadata.root_cause}`);
  lines.push(`- **Hotfix**: ${data.metadata.hotfix}`);
  lines.push(`- **${isZh ? '预计时长' : 'Estimated Runtime'}**: ${data.metadata.estimated_duration_minutes} ${isZh ? '分钟' : 'minutes'}`);
  lines.push('');

  // Transcript section
  lines.push(`## ${isZh ? '对话脚本' : 'Transcript'}`);
  lines.push('');

  for (const line of data.transcript) {
    lines.push(`**[${line.speaker}]**: ${line.text}`);
    lines.push('');
  }

  // Shorts section
  lines.push(`## ${isZh ? 'Shorts 金句提取' : 'Shorts Extraction'}`);
  for (let i = 0; i < data.shorts.length; i++) {
    const short = data.shorts[i];
    if (short) {
      lines.push(`${i + 1}. "${short.quote}" - ${isZh ? '第' : 'Act '}${short.act}${isZh ? '幕' : ''}`);
    }
  }
  lines.push('');

  // Glossary section
  lines.push(`## ${isZh ? '技术词汇表' : 'Technical Glossary'}`);
  for (const item of data.glossary) {
    lines.push(`- **${item.term}**: ${item.tech_definition} → ${item.life_application}`);
  }
  lines.push('');

  return lines.join('\n');
}

/**
 * Generate a single NotebookLM script for a specific language
 */
async function generateSingleScript(
  rawContent: string,
  projectId: string,
  language: 'en' | 'zh',
  geminiClient: GeminiClient
): Promise<{ content: string; metadata: GeneratedScript['metadata'] }> {
  const promptTemplate = language === 'en' ? EN_PROMPT_TEMPLATE : ZH_PROMPT_TEMPLATE;
  const prompt = promptTemplate.replace('{raw_content}', rawContent);

  const result = await geminiClient.generate(prompt, {
    projectId,
    priority: 'high'  // High priority since this is user-facing content
  });

  // Parse JSON response
  const parsed = safeJsonParse<ScriptResponse>(result.text, {
    projectId,
    operation: `notebooklm_script_${language}`
  });

  // Convert to Markdown format
  const content = formatScriptAsMarkdown(parsed, language);

  return {
    content,
    metadata: {
      estimatedDurationMinutes: parsed.metadata.estimated_duration_minutes ?? 12,
      shortsCount: parsed.shorts?.length ?? 3,
      bugReport: parsed.metadata.bug_report ?? '',
      rootCause: parsed.metadata.root_cause ?? '',
      hotfix: parsed.metadata.hotfix ?? ''
    }
  };
}

/**
 * Generate NotebookLM scripts for all specified languages
 */
export async function generateNotebookLMScripts(
  config: NotebookLMScriptConfig,
  geminiClient: GeminiClient
): Promise<GeneratedScript[]> {
  const results: GeneratedScript[] = [];

  for (const lang of config.languages) {
    logger.info(`Generating ${lang.toUpperCase()} NotebookLM script`, {
      projectId: config.projectId,
      language: lang
    });

    try {
      const { content, metadata } = await generateSingleScript(
        config.rawContent,
        config.projectId,
        lang,
        geminiClient
      );

      // Save script file
      const filename = `notebooklm_script_${lang}.md`;
      const filepath = join(config.projectDir, filename);
      await writeFile(filepath, content, 'utf-8');

      results.push({
        language: lang,
        content,
        filepath,
        metadata
      });

      logger.info(`NotebookLM script generated`, {
        projectId: config.projectId,
        language: lang,
        filepath: filename,
        charCount: content.length,
        estimatedMinutes: metadata.estimatedDurationMinutes
      });
    } catch (error) {
      logger.error(`Failed to generate ${lang} NotebookLM script`, {
        projectId: config.projectId,
        language: lang,
        error: (error as Error).message
      });
      // Continue with other languages even if one fails
    }
  }

  // Create audio directory
  const audioDir = join(config.projectDir, 'audio');
  await mkdir(audioDir, { recursive: true });
  await writeFile(join(audioDir, '.gitkeep'), '', 'utf-8');

  logger.info('Audio directory created', {
    projectId: config.projectId,
    audioDir
  });

  return results;
}

/**
 * Build audio configuration for manifest based on generated scripts
 */
export function buildAudioConfig(scripts: GeneratedScript[]): NotebookLMAudioConfig {
  const config: NotebookLMAudioConfig = {
    source: 'notebooklm',
    languages: {}
  };

  for (const script of scripts) {
    config.languages[script.language] = {
      script_path: `notebooklm_script_${script.language}.md`,
      audio_path: `audio/${script.language}.mp3`,
      audio_status: 'pending',
      duration_seconds: null
    };
  }

  return config;
}

/**
 * Check if audio file exists and update config with status and duration
 */
export async function checkAndUpdateAudioStatus(
  projectDir: string,
  audioConfig: NotebookLMAudioConfig
): Promise<NotebookLMAudioConfig> {
  const { existsSync } = await import('fs');
  const { execSync } = await import('child_process');

  const updatedConfig: NotebookLMAudioConfig = {
    ...audioConfig,
    languages: { ...audioConfig.languages }
  };

  for (const lang of ['en', 'zh'] as const) {
    const langConfig = updatedConfig.languages[lang];
    if (!langConfig) continue;

    const audioPath = join(projectDir, langConfig.audio_path);

    if (existsSync(audioPath)) {
      // Get audio duration using ffprobe
      let durationSeconds: number | null = null;
      try {
        const result = execSync(
          `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${audioPath}"`,
          { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
        );
        durationSeconds = parseFloat(result.trim());
        if (isNaN(durationSeconds)) {
          durationSeconds = null;
        }
      } catch {
        // ffprobe not available or failed, duration remains null
        logger.warn('Could not get audio duration', { audioPath });
      }

      updatedConfig.languages[lang] = {
        ...langConfig,
        audio_status: 'ready',
        duration_seconds: durationSeconds
      };

      logger.info('Audio file detected and status updated', {
        language: lang,
        audioPath,
        status: 'ready',
        durationSeconds
      });
    }
  }

  return updatedConfig;
}

/**
 * Log Next Steps instructions for NotebookLM audio generation
 */
export function printNextSteps(projectId: string, projectDir: string, scripts: GeneratedScript[]): void {
  const scriptDetails = scripts.map(script => ({
    language: script.language,
    filepath: script.filepath,
    audioPath: `${projectDir}/audio/${script.language}.mp3`
  }));

  const renderCommands = [
    `cd ../video-renderer`,
    `node render.mjs ${projectId} --lang=en`,
    `node render.mjs ${projectId} --lang=zh`
  ];

  logger.info('Orchestrator processing complete - awaiting audio generation', {
    projectId,
    status: 'pending_audio',
    scripts: scriptDetails,
    notebookLmUrl: 'https://notebooklm.google.com/',
    renderCommands,
    instructions: 'Upload scripts to NotebookLM, generate Audio Overview, download MP3 to audio directory'
  });
}
