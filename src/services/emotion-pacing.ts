import { logger } from '../utils/logger';

// ============================================
// Types
// ============================================

interface EmotionPacingConfig {
  baseGap: number;        // Base gap in seconds
  multiplier: number;     // Pacing multiplier
  description: string;    // Description for logging
}

interface PacingResult {
  gapSeconds: number;
  emotion: string;
  transition: string;
}

interface EmotionFlowAnalysis {
  emotions: string[];
  pacingCurve: number[];
  averagePacing: number;
  emotionTransitions: number;
}

interface Chapter {
  content: string;
  emotion?: string;
  timestamp?: string;
}

// ============================================
// Emotion Pacing Configuration
// ============================================

/**
 * Emotion-driven pacing configuration
 * Maps emotional states to appropriate pause durations
 */
const EMOTION_PACING_MAP: Record<string, EmotionPacingConfig> = {
  // Zen/Meditation - Long pauses for contemplation
  calm: { baseGap: 1.2, multiplier: 1.5, description: 'Calm, like water' },
  meditation: { baseGap: 1.5, multiplier: 1.8, description: 'Meditative state' },
  enlightenment: { baseGap: 2.0, multiplier: 2.0, description: 'Moment of realization' },
  stillness: { baseGap: 1.8, multiplier: 1.6, description: 'Complete stillness' },
  reflection: { baseGap: 1.3, multiplier: 1.4, description: 'Reflective pause' },

  // Tutorial/Technical - Medium pauses for comprehension
  tutorial: { baseGap: 0.6, multiplier: 1.0, description: 'Teaching moment' },
  explanation: { baseGap: 0.7, multiplier: 1.1, description: 'Explanation pause' },
  demonstration: { baseGap: 0.5, multiplier: 0.9, description: 'Demo pause' },
  technical: { baseGap: 0.65, multiplier: 1.05, description: 'Technical content' },

  // High Energy - Short pauses to maintain momentum
  excitement: { baseGap: 0.3, multiplier: 0.7, description: 'Excited delivery' },
  urgency: { baseGap: 0.2, multiplier: 0.5, description: 'Urgent pacing' },
  high_energy: { baseGap: 0.25, multiplier: 0.6, description: 'High energy' },
  hype: { baseGap: 0.2, multiplier: 0.55, description: 'Hype moment' },

  // Emotional States - Dynamic pauses based on mood
  sadness: { baseGap: 1.0, multiplier: 1.3, description: 'Sad moment' },
  joy: { baseGap: 0.4, multiplier: 0.8, description: 'Joyful' },
  anger: { baseGap: 0.3, multiplier: 0.6, description: 'Angry delivery' },
  surprise: { baseGap: 0.8, multiplier: 1.2, description: 'Surprising revelation' },
  fear: { baseGap: 0.5, multiplier: 0.9, description: 'Tense moment' },
  anticipation: { baseGap: 0.7, multiplier: 1.1, description: 'Building anticipation' },

  // Engagement Triggers
  curiosity: { baseGap: 0.6, multiplier: 1.0, description: 'Curiosity hook' },
  awe: { baseGap: 1.0, multiplier: 1.4, description: 'Awe-inspiring' },
  fomo: { baseGap: 0.35, multiplier: 0.65, description: 'Fear of missing out' },
  validation: { baseGap: 0.5, multiplier: 0.85, description: 'Validation moment' },

  // Default fallback
  default: { baseGap: 0.5, multiplier: 1.0, description: 'Default pacing' },
  neutral: { baseGap: 0.5, multiplier: 1.0, description: 'Neutral delivery' }
};

// Special keywords that trigger extended pauses
const ZEN_KEYWORDS = [
  '顿悟', '空性', '无我', '涅槃', '禅定',
  'enlightenment', 'awareness', 'presence', 'mindfulness', 'nirvana'
];

const TECH_KEYWORDS = [
  '高并发', '分布式', '微服务', 'kubernetes', 'microservice',
  'architecture', 'scalability', 'performance'
];

const DRAMATIC_KEYWORDS = [
  '震惊', '不可思议', '惊人',
  'shocking', 'incredible', 'unbelievable', 'breaking'
];

// ============================================
// Emotion Pacing Service
// ============================================

export class EmotionPacingService {
  /**
   * Calculate dynamic pacing gap based on emotion and context
   */
  calculateDynamicPacing(
    text: string,
    detectedEmotion: string,
    previousEmotion?: string
  ): PacingResult {
    const normalizedEmotion = detectedEmotion.toLowerCase().replace(/[^a-z_]/g, '');
    const config = EMOTION_PACING_MAP[normalizedEmotion] ?? EMOTION_PACING_MAP['default']!;

    let gapSeconds = config.baseGap;

    // Emotion transition handling (breathing effect)
    if (previousEmotion && previousEmotion !== detectedEmotion) {
      const prevNormalized = previousEmotion.toLowerCase().replace(/[^a-z_]/g, '');
      const prevConfig = EMOTION_PACING_MAP[prevNormalized] ?? EMOTION_PACING_MAP['default']!;

      // Transitioning from high energy to calm: longer pause (deceleration)
      if (prevConfig.multiplier < config.multiplier) {
        gapSeconds *= 1.5;
      }
      // Transitioning from calm to high energy: slightly longer pause (acceleration)
      else if (prevConfig.multiplier > config.multiplier) {
        gapSeconds *= 1.2;
      }
    }

    // Special keywords trigger additional pause
    const specialKeywords = this.detectSpecialKeywords(text);
    if (specialKeywords.length > 0) {
      // More keywords = more contemplation time
      const keywordMultiplier = Math.min(1.5, 1 + (specialKeywords.length * 0.1));
      gapSeconds *= keywordMultiplier;
    }

    // Ensure gap is within reasonable bounds
    gapSeconds = Math.max(0.1, Math.min(3.0, gapSeconds));

    return {
      gapSeconds,
      emotion: detectedEmotion,
      transition: previousEmotion ? `${previousEmotion} → ${detectedEmotion}` : 'initial'
    };
  }

  /**
   * Analyze emotion flow across an entire script/chapter sequence
   */
  analyzeEmotionFlow(chapters: Chapter[]): EmotionFlowAnalysis {
    const emotions: string[] = [];
    const pacingCurve: number[] = [];

    let previousEmotion: string | undefined;

    for (const chapter of chapters) {
      const emotion = chapter.emotion || 'default';
      const pacing = this.calculateDynamicPacing(
        chapter.content,
        emotion,
        previousEmotion
      );

      emotions.push(emotion);
      pacingCurve.push(pacing.gapSeconds);
      previousEmotion = emotion;
    }

    const averagePacing = pacingCurve.length > 0
      ? pacingCurve.reduce((a, b) => a + b, 0) / pacingCurve.length
      : 0.5;

    return {
      emotions,
      pacingCurve,
      averagePacing,
      emotionTransitions: this.countTransitions(emotions)
    };
  }

  /**
   * Get recommended pacing for a specific emotion
   */
  getEmotionConfig(emotion: string): EmotionPacingConfig {
    const normalized = emotion.toLowerCase().replace(/[^a-z_]/g, '');
    return EMOTION_PACING_MAP[normalized] ?? EMOTION_PACING_MAP['default']!;
  }

  /**
   * Get all available emotion types
   */
  getAvailableEmotions(): string[] {
    return Object.keys(EMOTION_PACING_MAP);
  }

  /**
   * Suggest emotion based on text content analysis
   */
  suggestEmotion(text: string): string {
    const lowerText = text.toLowerCase();

    // Check for zen/meditation keywords
    for (const keyword of ZEN_KEYWORDS) {
      if (lowerText.includes(keyword.toLowerCase())) {
        return 'meditation';
      }
    }

    // Check for dramatic keywords
    for (const keyword of DRAMATIC_KEYWORDS) {
      if (lowerText.includes(keyword.toLowerCase())) {
        return 'surprise';
      }
    }

    // Check for technical content
    for (const keyword of TECH_KEYWORDS) {
      if (lowerText.includes(keyword.toLowerCase())) {
        return 'technical';
      }
    }

    // Check for question marks (curiosity)
    if ((text.match(/\?/g) || []).length > 2) {
      return 'curiosity';
    }

    // Check for exclamation marks (excitement)
    if ((text.match(/!/g) || []).length > 2) {
      return 'excitement';
    }

    return 'default';
  }

  /**
   * Detect special keywords that warrant extended pauses
   */
  private detectSpecialKeywords(text: string): string[] {
    const found: string[] = [];
    const lowerText = text.toLowerCase();

    const allKeywords = [...ZEN_KEYWORDS, ...TECH_KEYWORDS, ...DRAMATIC_KEYWORDS];

    for (const keyword of allKeywords) {
      if (lowerText.includes(keyword.toLowerCase())) {
        found.push(keyword);
      }
    }

    return found;
  }

  /**
   * Count emotion transitions in a sequence
   */
  private countTransitions(emotions: string[]): number {
    let transitions = 0;
    for (let i = 1; i < emotions.length; i++) {
      if (emotions[i] !== emotions[i - 1]) {
        transitions++;
      }
    }
    return transitions;
  }

  /**
   * Generate a pacing report for debugging/logging
   */
  generatePacingReport(chapters: Chapter[]): {
    analysis: EmotionFlowAnalysis;
    recommendations: string[];
  } {
    const analysis = this.analyzeEmotionFlow(chapters);
    const recommendations: string[] = [];

    // Check for monotonous pacing
    if (analysis.emotionTransitions < chapters.length * 0.2) {
      recommendations.push(
        'Consider adding more emotional variety to maintain viewer engagement'
      );
    }

    // Check for too rapid pacing
    if (analysis.averagePacing < 0.3) {
      recommendations.push(
        'Pacing may be too fast - consider adding breathing room between segments'
      );
    }

    // Check for too slow pacing
    if (analysis.averagePacing > 1.5) {
      recommendations.push(
        'Pacing may be too slow for typical YouTube content - consider tightening delivery'
      );
    }

    // Check for abrupt transitions
    const abruptTransitions = analysis.pacingCurve.filter(
      (gap, i) => i > 0 && Math.abs(gap - analysis.pacingCurve[i - 1]!) > 1.0
    ).length;

    if (abruptTransitions > analysis.pacingCurve.length * 0.3) {
      recommendations.push(
        'Several abrupt pacing changes detected - consider smoothing transitions'
      );
    }

    logger.debug('Pacing report generated', {
      chapters: chapters.length,
      averagePacing: analysis.averagePacing.toFixed(2),
      transitions: analysis.emotionTransitions,
      recommendations: recommendations.length
    });

    return { analysis, recommendations };
  }
}

// Export singleton instance
export const emotionPacing = new EmotionPacingService();

// Export types
export type { EmotionPacingConfig, PacingResult, EmotionFlowAnalysis, Chapter };
