import type { VoicePersonaSchema } from '../core/manifest';
import type { z } from 'zod';
import { logger } from '../utils/logger';

type VoicePersona = z.infer<typeof VoicePersonaSchema>;
type Mood = 'professional' | 'casual' | 'energetic' | 'calm';
type ContentType = 'tutorial' | 'news' | 'analysis' | 'entertainment';
type Language = 'en' | 'zh' | 'ja' | 'es' | 'de';

interface VoiceProfile {
  voice_id: string;
  provider: VoicePersona['provider'];
  style: VoicePersona['style'];
  name: string;
  best_for: { moods: Mood[]; content_types: ContentType[] };
}

// ElevenLabs voice catalog
const VOICE_CATALOG: Record<Language, VoiceProfile[]> = {
  en: [
    {
      voice_id: 'pNInz6obpgDQGcFmaJgB',
      provider: 'elevenlabs',
      style: 'professional',
      name: 'Adam',
      best_for: { moods: ['professional', 'calm'], content_types: ['tutorial', 'analysis'] }
    },
    {
      voice_id: 'EXAVITQu4vr4xnSDxMaL',
      provider: 'elevenlabs',
      style: 'energetic',
      name: 'Bella',
      best_for: { moods: ['energetic', 'casual'], content_types: ['entertainment', 'news'] }
    },
    {
      voice_id: '21m00Tcm4TlvDq8ikWAM',
      provider: 'elevenlabs',
      style: 'narrative',
      name: 'Rachel',
      best_for: { moods: ['calm', 'professional'], content_types: ['analysis', 'tutorial'] }
    },
    {
      voice_id: 'yoZ06aMxZJJ28mfd3POQ',
      provider: 'elevenlabs',
      style: 'energetic',
      name: 'Sam',
      best_for: { moods: ['energetic', 'casual'], content_types: ['news', 'entertainment'] }
    }
  ],
  zh: [
    {
      voice_id: 'zh-CN-YunxiNeural',
      provider: 'azure',
      style: 'professional',
      name: 'Yunxi',
      best_for: { moods: ['professional', 'calm'], content_types: ['tutorial', 'analysis'] }
    },
    {
      voice_id: 'zh-CN-XiaoxiaoNeural',
      provider: 'azure',
      style: 'energetic',
      name: 'Xiaoxiao',
      best_for: { moods: ['energetic', 'casual'], content_types: ['entertainment', 'news'] }
    }
  ],
  ja: [
    {
      voice_id: 'ja-JP-NanamiNeural',
      provider: 'azure',
      style: 'professional',
      name: 'Nanami',
      best_for: { moods: ['professional', 'calm'], content_types: ['tutorial', 'analysis'] }
    }
  ],
  es: [
    {
      voice_id: 'es-ES-AlvaroNeural',
      provider: 'azure',
      style: 'professional',
      name: 'Alvaro',
      best_for: { moods: ['professional', 'energetic'], content_types: ['tutorial', 'news'] }
    }
  ],
  de: [
    {
      voice_id: 'de-DE-ConradNeural',
      provider: 'azure',
      style: 'professional',
      name: 'Conrad',
      best_for: { moods: ['professional', 'calm'], content_types: ['tutorial', 'analysis'] }
    }
  ]
};

/**
 * 根据 mood + content_type + language 匹配最佳 Voice Persona
 */
export function matchVoice(
  mood: Mood,
  contentType: ContentType,
  language: Language
): VoicePersona {
  const candidates = VOICE_CATALOG[language] ?? VOICE_CATALOG['en']!;

  // 评分：mood 匹配 +2, content_type 匹配 +1
  let bestScore = -1;
  let bestProfile = candidates[0]!;

  for (const profile of candidates) {
    let score = 0;
    if (profile.best_for.moods.includes(mood)) score += 2;
    if (profile.best_for.content_types.includes(contentType)) score += 1;

    if (score > bestScore) {
      bestScore = score;
      bestProfile = profile;
    }
  }

  logger.info('Voice matched', {
    name: bestProfile.name,
    mood,
    contentType,
    language,
    score: bestScore
  });

  return {
    provider: bestProfile.provider,
    voice_id: bestProfile.voice_id,
    style: bestProfile.style,
    language
  };
}
