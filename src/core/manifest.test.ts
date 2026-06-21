import { test, expect, describe } from 'bun:test';
import { EntitySchema, FAQItemSchema } from './manifest';

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
