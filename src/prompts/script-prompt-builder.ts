import type { ChannelProfile } from '../core/channel-profile';

/**
 * Visual hint enum values accepted by the script segment schema.
 */
const VISUAL_HINT_VALUES = [
  'code_block',
  'diagram',
  'text_animation',
  'b-roll',
  'screen_recording',
  'talking_head_placeholder',
] as const;

/**
 * Build a rich prompt for video script generation that incorporates
 * channel profile voice, audience, and quality constraints.
 *
 * The returned prompt does NOT include the self-scoring suffix --
 * that is appended separately by generateWithSelfScoring().
 */
export function buildScriptPrompt(
  rawContent: string,
  profile: ChannelProfile,
  language: string,
): string {
  const sections: string[] = [];

  // ----------------------------------------------------------------
  // 1. Role assignment
  // ----------------------------------------------------------------
  sections.push(
    `You are the lead scriptwriter for "${profile.channel_name}" -- ${profile.tagline}.`,
    `Your task is to convert the raw content below into a compelling ${language} video script with timestamps.`,
  );

  // ----------------------------------------------------------------
  // 2. Channel voice
  // ----------------------------------------------------------------
  const voice = profile.voice;
  const voiceLines: string[] = [
    '## Channel Voice',
    `- Tone: ${voice.tone.join(', ')}`,
    `- Vocabulary level: ${voice.vocabulary_level}`,
    `- Perspective: ${voice.perspective}`,
  ];

  if (voice.example_phrases.length > 0) {
    voiceLines.push(
      `- Example phrases the channel uses: ${voice.example_phrases.map(p => `"${p}"`).join('; ')}`,
    );
  }

  if (voice.forbidden_words.length > 0) {
    voiceLines.push(
      `- Forbidden words (NEVER use these): ${voice.forbidden_words.join(', ')}`,
    );
  }

  sections.push(voiceLines.join('\n'));

  // ----------------------------------------------------------------
  // 3. Audience
  // ----------------------------------------------------------------
  const audience = profile.audience;
  const audienceLines: string[] = [
    '## Target Audience',
    `- Demographics: ${audience.demographics}`,
    `- Knowledge level: ${audience.knowledge_level}`,
  ];

  if (audience.pain_points.length > 0) {
    audienceLines.push(
      `- Pain points to address: ${audience.pain_points.join('; ')}`,
    );
  }

  sections.push(audienceLines.join('\n'));

  // ----------------------------------------------------------------
  // 4. Quality requirements
  // ----------------------------------------------------------------
  const quality = profile.quality;
  const qualityLines: string[] = [
    '## Quality Requirements',
    `- Produce at least ${quality.min_segment_count} segments`,
    `- Filler ratio must stay below ${(quality.max_filler_ratio * 100).toFixed(0)}% -- avoid filler words, hedging, and repetitive phrases`,
  ];

  if (quality.required_elements.length > 0) {
    qualityLines.push(
      `- Required structural elements: ${quality.required_elements.join(', ')}`,
    );
  }

  sections.push(qualityLines.join('\n'));

  // ----------------------------------------------------------------
  // 5. Output format
  // ----------------------------------------------------------------
  sections.push(
    [
      '## Output Format',
      '',
      'Return a JSON object with this exact structure:',
      '```',
      '{',
      '  "script": [',
      '    {',
      '      "timestamp": "MM:SS",',
      '      "voiceover": "<narration text>",',
      `      "visual_hint": "${VISUAL_HINT_VALUES.join('" | "')}",`,
      '      "estimated_duration_seconds": <positive number>',
      '    }',
      '  ],',
      '  "estimated_duration_seconds": <total positive number>',
      '}',
      '```',
      '',
      'Rules:',
      '- timestamp must be in MM:SS format (e.g. "00:00", "01:30")',
      `- visual_hint must be exactly one of: ${VISUAL_HINT_VALUES.join(', ')}`,
      '- estimated_duration_seconds must be a positive number',
      '- Return ONLY valid JSON, no markdown fences or explanations outside the JSON',
    ].join('\n'),
  );

  // ----------------------------------------------------------------
  // 6. Raw content
  // ----------------------------------------------------------------
  sections.push(`## Content to Convert\n\n${rawContent}`);

  return sections.join('\n\n');
}
