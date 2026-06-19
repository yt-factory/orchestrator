import type { ShortsExtraction, ShortsHook, ScriptSegment } from '../core/manifest';
import type { BaseLLMProvider } from '../llm/providers';
import { loadPrompt } from '../llm/prompts/loader';
import { logger } from '../utils/logger';
import { safeJsonParse } from '../utils/json-parse';

// CTA 模板 (根据情绪类型)
const CTA_TEMPLATES: Record<string, string[]> = {
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

/**
 * 注入 CTA
 */
function injectCTA(hook: ShortsHook): ShortsHook {
  const templates = CTA_TEMPLATES[hook.emotional_trigger];
  if (!templates || templates.length === 0) return hook;

  const cta = templates[Math.floor(Math.random() * templates.length)]!;

  return {
    ...hook,
    injected_cta: cta
  };
}

/**
 * 提取 Shorts hooks
 */
export async function extractShortsHooks(
  script: ScriptSegment[],
  projectId: string,
  provider: BaseLLMProvider
): Promise<ShortsExtraction> {
  const fullScript = script
    .map((s) => `[${s.timestamp}] ${s.voiceover}`)
    .join('\n');

  const { system, user, version } = loadPrompt('shorts/extraction', { script: fullScript });

  // tier: smart — viral hook ideation is creative work.
  const result = await provider.complete(system, user, {
    tier: 'smart',
    projectId,
    priority: 'low',
    templateVersion: version,
  });

  const parsed = safeJsonParse<{
    hooks: ShortsHook[];
    vertical_crop_focus: 'center' | 'left' | 'right' | 'speaker' | 'dynamic';
    recommended_music_mood?: 'upbeat' | 'dramatic' | 'chill' | 'none';
  }>(result.text, { projectId, operation: 'extractShortsHooks' });

  // 注入 CTA
  const hooksWithCTA: ShortsHook[] = parsed.hooks.map((hook: ShortsHook) => injectCTA(hook));

  // 排序：优先高情绪触发
  const emotionPriority: Record<string, number> = {
    anger: 0,
    awe: 1,
    fomo: 2,
    curiosity: 3,
    validation: 4
  };

  hooksWithCTA.sort((a, b) => {
    return (emotionPriority[a.emotional_trigger] ?? 99) - (emotionPriority[b.emotional_trigger] ?? 99);
  });

  // 确定是否需要人脸检测
  const needsFaceDetection = hooksWithCTA.some(
    (h) => (h as Record<string, unknown>)['face_detection_required'] === true || h.hook_type === 'controversy'
  );

  logger.info('Shorts hooks extracted', {
    projectId,
    count: hooksWithCTA.length,
    topEmotion: hooksWithCTA[0]?.emotional_trigger,
    needsFaceDetection
  });

  return {
    hooks: hooksWithCTA,
    vertical_crop_focus: parsed.vertical_crop_focus,
    recommended_music_mood: parsed.recommended_music_mood,
    face_detection_hint: needsFaceDetection
  };
}
