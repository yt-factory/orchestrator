import { ShortsCandidate, ScriptSegment } from '../core/manifest';
import { GeminiClient } from '../agents/gemini-client';
import { logger } from '../utils/logger';

// Emotion-to-CTA mapping for viral optimization
const EMOTION_CTA_MAP: Record<string, string[]> = {
  controversy: [
    '你同意吗？评论区见 👇',
    'Agree or disagree? Comment below!',
    'Hot take - what do you think?'
  ],
  fomo: [
    '完整版揭秘 → 主页置顶',
    'Full breakdown in pinned video!',
    'Don\'t miss the full guide ↑'
  ],
  curiosity: [
    '结局你绝对想不到...',
    'Wait for it...',
    'The ending will shock you'
  ],
  anger: [
    '这太离谱了！你怎么看？',
    'This is insane! Your thoughts?',
    'Someone had to say it 💢'
  ],
  awe: [
    '更多震撼内容在主页 🔥',
    'Mind = blown 🤯 More on my page!',
    'This changed everything'
  ],
  surprise: [
    '万万没想到！👀',
    'Plot twist incoming!',
    'Bet you didn\'t see that coming'
  ],
  humor: [
    '笑死我了 😂 更多在主页',
    'I can\'t 💀 More content on my page',
    'Tag someone who needs this 😂'
  ]
};

// Emotion engagement patterns
const EMOTION_ENGAGEMENT_PATTERNS: Record<
  string,
  { comments: 'low' | 'medium' | 'high'; shares: 'low' | 'medium' | 'high'; completion: 'low' | 'medium' | 'high' }
> = {
  anger: { comments: 'high', shares: 'medium', completion: 'high' },
  awe: { comments: 'medium', shares: 'high', completion: 'high' },
  curiosity: { comments: 'medium', shares: 'medium', completion: 'high' },
  fomo: { comments: 'medium', shares: 'high', completion: 'medium' },
  controversy: { comments: 'high', shares: 'high', completion: 'medium' },
  surprise: { comments: 'medium', shares: 'high', completion: 'high' },
  humor: { comments: 'high', shares: 'high', completion: 'medium' },
  validation: { comments: 'high', shares: 'medium', completion: 'medium' }
};

// Keywords that indicate emotional triggers
const EMOTION_KEYWORDS: Record<string, string[]> = {
  controversy: [
    'controversial', 'debate', 'unpopular opinion', 'hot take',
    'disagree', 'wrong', 'actually', 'myth', 'lie', 'truth'
  ],
  fomo: [
    'limited', 'exclusive', 'only', 'secret', 'hidden', 'most people',
    'few know', 'before it\'s too late', 'miss out', 'opportunity'
  ],
  curiosity: [
    'how', 'why', 'what if', 'discover', 'reveal', 'uncover',
    'mystery', 'question', 'wonder', 'curious'
  ],
  anger: [
    'outrageous', 'unfair', 'scam', 'fraud', 'rip-off', 'terrible',
    'worst', 'unacceptable', 'disgusting', 'shameful'
  ],
  awe: [
    'amazing', 'incredible', 'unbelievable', 'mind-blowing', 'insane',
    'revolutionary', 'game-changer', 'breakthrough', 'stunning'
  ],
  surprise: [
    'shocking', 'unexpected', 'plot twist', 'suddenly', 'turns out',
    'actually', 'but then', 'little did', 'never knew'
  ],
  humor: [
    'funny', 'hilarious', 'joke', 'lol', 'comedy', 'ridiculous',
    'absurd', 'ironic', 'sarcastic', 'parody'
  ]
};

/**
 * Extracts high-emotion segments from scripts for YouTube Shorts
 */
export class ShortsEmotionExtractor {
  constructor(private geminiClient: GeminiClient) {}

  /**
   * Main extraction method - finds the best Shorts candidates
   */
  async extractShortsHooks(
    projectId: string,
    script: ScriptSegment[],
    maxCandidates: number = 5
  ): Promise<ShortsCandidate[]> {
    logger.info('Starting Shorts emotion extraction', {
      projectId,
      segmentCount: script.length,
      maxCandidates
    });

    // Step 1: Quick keyword-based pre-filtering
    const preFilteredSegments = this.preFilterByKeywords(script);

    // Step 2: AI-powered deep analysis
    const candidates = await this.deepEmotionAnalysis(
      projectId,
      preFilteredSegments,
      maxCandidates
    );

    // Step 3: Sort by viral potential
    const sortedCandidates = this.sortByViralPotential(candidates);

    // Step 4: Assign CTAs based on emotion
    const finalCandidates = sortedCandidates
      .slice(0, maxCandidates)
      .map((c) => this.assignCTA(c));

    logger.info('Shorts extraction complete', {
      projectId,
      candidatesFound: finalCandidates.length,
      topEmotion: finalCandidates[0]?.emotion
    });

    return finalCandidates;
  }

  /**
   * Pre-filter segments by emotional keywords
   */
  private preFilterByKeywords(
    script: ScriptSegment[]
  ): Array<{ segment: ScriptSegment; index: number; emotionHints: string[] }> {
    const results: Array<{
      segment: ScriptSegment;
      index: number;
      emotionHints: string[];
    }> = [];

    let currentTime = 0;
    for (let i = 0; i < script.length; i++) {
      const segment = script[i];
      if (!segment) continue;

      const text = segment.voiceover.toLowerCase();
      const emotionHints: string[] = [];

      for (const [emotion, keywords] of Object.entries(EMOTION_KEYWORDS)) {
        for (const keyword of keywords) {
          if (text.includes(keyword)) {
            if (!emotionHints.includes(emotion)) {
              emotionHints.push(emotion);
            }
          }
        }
      }

      // Include segments with emotion hints or interesting visual types
      if (
        emotionHints.length > 0 ||
        segment.visual_hint === 'talking_head_placeholder'
      ) {
        results.push({ segment, index: i, emotionHints });
      }

      currentTime += segment.estimated_duration_seconds;
    }

    return results;
  }

  /**
   * Deep emotion analysis using AI
   */
  private async deepEmotionAnalysis(
    projectId: string,
    segments: Array<{ segment: ScriptSegment; index: number; emotionHints: string[] }>,
    maxCandidates: number
  ): Promise<ShortsCandidate[]> {
    if (segments.length === 0) {
      // If no pre-filtered segments, analyze entire script
      return [];
    }

    const segmentTexts = segments
      .map(
        (s, i) =>
          `[${i}] (${s.segment.timestamp}) ${s.segment.voiceover.slice(0, 200)}`
      )
      .join('\n\n');

    const prompt = `
Analyze these video script segments for YouTube Shorts potential.
Identify the ${maxCandidates} best moments for viral Shorts clips.

SEGMENTS:
${segmentTexts}

For each selected segment, analyze:
1. Primary emotion: controversy, fomo, curiosity, anger, awe, surprise, humor
2. Controversy score (0-10): How likely to spark debate?
3. Hook strength (0-10): How compelling is the opening?

Output as JSON array:
[
  {
    "segment_index": number,
    "emotion": "controversy|fomo|curiosity|anger|awe|surprise|humor",
    "controversy_score": number,
    "hook_strength": number,
    "best_snippet": "exact text that works best as hook (max 100 chars)"
  }
]

Prioritize:
- Segments with controversy_score > 5
- Strong hooks that work standalone
- Emotionally charged statements
`;

    try {
      const result = await this.geminiClient.generate(prompt, {
        projectId,
        priority: 'low'
      });

      const parsed = JSON.parse(result.text);
      const candidates: ShortsCandidate[] = [];

      // Calculate cumulative time for timestamp mapping
      let currentTime = 0;
      const segmentStartTimes: number[] = [];
      for (const { segment } of segments) {
        segmentStartTimes.push(currentTime);
        currentTime += segment.estimated_duration_seconds;
      }

      for (const item of parsed) {
        const segmentData = segments[item.segment_index];
        if (!segmentData) continue;

        const startTime = segmentStartTimes[item.segment_index] || 0;
        const endTime = startTime + Math.min(60, segmentData.segment.estimated_duration_seconds);

        candidates.push({
          start_time: startTime,
          end_time: endTime,
          emotion: item.emotion,
          controversy_score: item.controversy_score,
          hook_strength: item.hook_strength,
          recommended_cta: '', // Will be assigned later
          transcript_snippet: item.best_snippet || segmentData.segment.voiceover.slice(0, 100)
        });
      }

      return candidates;
    } catch (error) {
      logger.warn('Deep emotion analysis failed, using keyword-based fallback', {
        projectId,
        error: (error as Error).message
      });

      // Fallback to keyword-based analysis
      return this.keywordBasedFallback(segments);
    }
  }

  /**
   * Fallback analysis when AI fails
   */
  private keywordBasedFallback(
    segments: Array<{ segment: ScriptSegment; index: number; emotionHints: string[] }>
  ): ShortsCandidate[] {
    const candidates: ShortsCandidate[] = [];
    let currentTime = 0;

    for (const { segment, emotionHints } of segments) {
      if (emotionHints.length === 0) {
        currentTime += segment.estimated_duration_seconds;
        continue;
      }

      const primaryEmotion = emotionHints[0] as ShortsCandidate['emotion'];
      const controversyScore = this.calculateControversyScore(segment.voiceover);
      const hookStrength = this.calculateHookStrength(segment.voiceover);

      candidates.push({
        start_time: currentTime,
        end_time: currentTime + Math.min(60, segment.estimated_duration_seconds),
        emotion: primaryEmotion,
        controversy_score: controversyScore,
        hook_strength: hookStrength,
        recommended_cta: '',
        transcript_snippet: segment.voiceover.slice(0, 100)
      });

      currentTime += segment.estimated_duration_seconds;
    }

    return candidates;
  }

  /**
   * Calculate controversy score based on text analysis
   */
  private calculateControversyScore(text: string): number {
    const lowerText = text.toLowerCase();
    let score = 0;

    // Controversial keywords
    const controversialTerms = [
      'wrong', 'lie', 'myth', 'truth', 'actually', 'unpopular',
      'controversial', 'debate', 'disagree', 'overrated'
    ];

    for (const term of controversialTerms) {
      if (lowerText.includes(term)) score += 2;
    }

    // Question marks increase controversy potential
    score += (text.match(/\?/g) || []).length * 0.5;

    // Exclamation marks indicate emotion
    score += (text.match(/!/g) || []).length * 0.3;

    return Math.min(10, score);
  }

  /**
   * Calculate hook strength based on opening
   */
  private calculateHookStrength(text: string): number {
    const lowerText = text.toLowerCase();
    let score = 5; // Base score

    // Strong hook patterns
    const strongHooks = [
      'here\'s why', 'the truth about', 'nobody talks about',
      'stop doing', 'you need to', 'this is how', 'secret to',
      'most people', 'biggest mistake'
    ];

    for (const hook of strongHooks) {
      if (lowerText.includes(hook)) score += 1.5;
    }

    // Numbers in hooks are strong
    if (/\d+/.test(text.slice(0, 50))) score += 1;

    // Short, punchy openings score higher
    const firstSentence = text.split(/[.!?]/)[0] || '';
    if (firstSentence.length < 50) score += 1;

    return Math.min(10, score);
  }

  /**
   * Sort candidates by viral potential
   */
  private sortByViralPotential(candidates: ShortsCandidate[]): ShortsCandidate[] {
    return candidates.sort((a, b) => {
      // Priority order for emotions
      const emotionPriority: Record<string, number> = {
        anger: 0,
        controversy: 1,
        awe: 2,
        fomo: 3,
        curiosity: 4,
        surprise: 5,
        humor: 6
      };

      // Primary sort: emotion priority
      const emotionDiff =
        (emotionPriority[a.emotion] ?? 7) - (emotionPriority[b.emotion] ?? 7);
      if (emotionDiff !== 0) return emotionDiff;

      // Secondary sort: controversy score
      const controversyDiff = b.controversy_score - a.controversy_score;
      if (controversyDiff !== 0) return controversyDiff;

      // Tertiary sort: hook strength
      return b.hook_strength - a.hook_strength;
    });
  }

  /**
   * Assign appropriate CTA based on emotion type
   */
  private assignCTA(candidate: ShortsCandidate): ShortsCandidate {
    const ctaOptions = EMOTION_CTA_MAP[candidate.emotion] || EMOTION_CTA_MAP['awe'] || ['Check out more!'];
    const randomIndex = Math.floor(Math.random() * ctaOptions.length);

    return {
      ...candidate,
      recommended_cta: ctaOptions[randomIndex] ?? 'Check out more!'
    };
  }

  /**
   * Get predicted engagement based on emotion
   */
  getEngagementPrediction(
    emotion: string
  ): { comments: 'low' | 'medium' | 'high'; shares: 'low' | 'medium' | 'high'; completion: 'low' | 'medium' | 'high' } {
    return (
      EMOTION_ENGAGEMENT_PATTERNS[emotion] || {
        comments: 'medium',
        shares: 'medium',
        completion: 'medium'
      }
    );
  }
}
