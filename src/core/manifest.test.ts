import { test, expect, describe } from 'bun:test';
import {
  EntitySchema,
  FAQItemSchema,
  ScriptSegmentSchema,
  ShortsHookSchema,
  ShortsExtractionSchema,
} from './manifest';

const VALID_HOOK = {
  text: 'hook',
  timestamp_start: '00:01',
  timestamp_end: '00:05',
  hook_type: 'quick_tip',
  emotional_trigger: 'curiosity',
  controversy_score: 5,
  predicted_engagement: { comments: 'high', shares: 'low', completion_rate: 'medium' },
};

describe('EntitySchema entity-type coercion', () => {
  test("entity with unknown type is coerced to 'concept'", () => {
    const result = EntitySchema.parse({
      name: 'Topological Sort',
      type: 'algorithm', // not in enum
      description: 'A graph algorithm',
    });
    expect(result.type).toBe('concept');
  });

  test('entity with valid type passes through unchanged', () => {
    const result = EntitySchema.parse({
      name: 'Donald Knuth',
      type: 'person',
      description: 'Computer scientist',
    });
    expect(result.type).toBe('person');
  });

  test('each of the 5 valid types is preserved', () => {
    for (const type of ['tool', 'concept', 'person', 'company', 'technology'] as const) {
      expect(EntitySchema.parse({ name: 'x', type }).type).toBe(type);
    }
  });

  test('coercion does not reject — the whole entity still parses', () => {
    const result = EntitySchema.parse({ name: 'Graph', type: 'data_structure' });
    expect(result).toMatchObject({ name: 'Graph', type: 'concept' });
  });

  test('missing entity name defaults to empty string (no crash)', () => {
    expect(EntitySchema.parse({ type: 'concept' }).name).toBe('');
  });
});

describe('FAQItemSchema defensive coercion', () => {
  test('missing related_entities defaults to [] (ep58 bug)', () => {
    const result = FAQItemSchema.parse({ question: 'Q?', answer: 'A.' });
    expect(result.related_entities).toEqual([]);
  });

  test('related_entities over the cap of 3 keeps the first 3', () => {
    const result = FAQItemSchema.parse({
      question: 'Q?',
      answer: 'A.',
      related_entities: ['a', 'b', 'c', 'd', 'e'],
    });
    expect(result.related_entities).toEqual(['a', 'b', 'c']);
  });

  test('answer over 200 chars is truncated, not rejected', () => {
    const result = FAQItemSchema.parse({ question: 'Q?', answer: 'x'.repeat(250), related_entities: [] });
    expect(result.answer.length).toBe(200);
  });

  test('a fully valid FAQ item passes through unchanged', () => {
    const item = { question: '什麼是空間換時間？', answer: '用記憶體換速度。', related_entities: ['cache'] };
    expect(FAQItemSchema.parse(item)).toEqual(item);
  });
});

describe('ScriptSegmentSchema defensive coercion', () => {
  const base = { timestamp: '00:30', voiceover: 'hi', visual_hint: 'diagram' as const, estimated_duration_seconds: 4 };

  test('unknown visual_hint coerces to text_animation', () => {
    expect(ScriptSegmentSchema.parse({ ...base, visual_hint: 'meme' }).visual_hint).toBe('text_animation');
  });

  test('invalid/missing timestamp coerces to 00:00', () => {
    expect(ScriptSegmentSchema.parse({ ...base, timestamp: '1:5' }).timestamp).toBe('00:00');
    expect(ScriptSegmentSchema.parse({ ...base, timestamp: undefined }).timestamp).toBe('00:00');
  });

  test('non-positive / missing duration falls back to 1', () => {
    expect(ScriptSegmentSchema.parse({ ...base, estimated_duration_seconds: 0 }).estimated_duration_seconds).toBe(1);
    expect(ScriptSegmentSchema.parse({ ...base, estimated_duration_seconds: undefined }).estimated_duration_seconds).toBe(1);
  });

  test('valid segment passes through', () => {
    expect(ScriptSegmentSchema.parse(base)).toEqual(base);
  });
});

describe('ShortsHookSchema defensive coercion', () => {
  test('unknown hook_type / emotional_trigger coerce to defaults', () => {
    const r = ShortsHookSchema.parse({ ...VALID_HOOK, hook_type: 'clickbait', emotional_trigger: 'rage' });
    expect(r.hook_type).toBe('quick_tip');
    expect(r.emotional_trigger).toBe('curiosity');
  });

  test('controversy_score clamps to [0,10]', () => {
    expect(ShortsHookSchema.parse({ ...VALID_HOOK, controversy_score: 99 }).controversy_score).toBe(10);
    expect(ShortsHookSchema.parse({ ...VALID_HOOK, controversy_score: -3 }).controversy_score).toBe(0);
  });

  test('missing predicted_engagement defaults to all-medium', () => {
    const { predicted_engagement, ...noEngagement } = VALID_HOOK;
    expect(ShortsHookSchema.parse(noEngagement).predicted_engagement).toEqual({
      comments: 'medium', shares: 'medium', completion_rate: 'medium',
    });
  });

  test('invalid engagement sub-value coerces to medium', () => {
    const r = ShortsHookSchema.parse({ ...VALID_HOOK, predicted_engagement: { comments: 'huge', shares: 'low', completion_rate: 'high' } });
    expect(r.predicted_engagement.comments).toBe('medium');
    expect(r.predicted_engagement.shares).toBe('low');
  });

  test('overlong text is truncated to 50 chars', () => {
    expect(ShortsHookSchema.parse({ ...VALID_HOOK, text: 'x'.repeat(80) }).text.length).toBe(50);
  });
});

describe('ShortsExtractionSchema defensive coercion', () => {
  test('hooks over 5 are truncated', () => {
    const hooks = Array.from({ length: 8 }, () => ({ ...VALID_HOOK }));
    expect(ShortsExtractionSchema.parse({ hooks, vertical_crop_focus: 'center' }).hooks).toHaveLength(5);
  });

  test('null vertical_crop_focus / music preserved (skipped Stage 5)', () => {
    const r = ShortsExtractionSchema.parse({ hooks: [], vertical_crop_focus: null, recommended_music_mood: null });
    expect(r.vertical_crop_focus).toBeNull();
    expect(r.recommended_music_mood).toBeNull();
  });

  test('invalid crop / music coerce; absent music stays undefined', () => {
    const r = ShortsExtractionSchema.parse({ hooks: [], vertical_crop_focus: 'middle', recommended_music_mood: 'epic' });
    expect(r.vertical_crop_focus).toBe('center');
    expect(r.recommended_music_mood).toBe('none');
    const r2 = ShortsExtractionSchema.parse({ hooks: [], vertical_crop_focus: 'center' });
    expect(r2.recommended_music_mood).toBeUndefined();
  });
});
