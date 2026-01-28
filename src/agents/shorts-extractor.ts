import type { ShortsExtraction, ShortsHook, ScriptSegment } from '../core/manifest';
import type { GeminiClient } from './gemini-client';
import { logger } from '../utils/logger';

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

const SHORTS_EXTRACTION_PROMPT = `
Analyze this video script and identify the 3-5 best moments for YouTube Shorts.

For EACH moment, analyze:

1. **Hook Type Classification:**
   - counter_intuitive: "Most people think X, but actually Y"
   - number_shock: "This saved me $10,000" or "In just 5 minutes"
   - controversy: Statements that spark debate
   - quick_tip: Immediately actionable advice

2. **Emotional Trigger (CRITICAL for virality):**
   - anger: Makes viewers want to comment/argue → HIGH comment rate
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
      "text": "Hook text for overlay (max 50 chars)",
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
  geminiClient: GeminiClient
): Promise<ShortsExtraction> {
  const fullScript = script
    .map((s) => `[${s.timestamp}] ${s.voiceover}`)
    .join('\n');

  const result = await geminiClient.generate(
    SHORTS_EXTRACTION_PROMPT + '\n\nScript:\n' + fullScript,
    { projectId, priority: 'low' }
  );

  const parsed = JSON.parse(result.text);

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
