import { test, expect, describe } from 'bun:test';
import { EntitySchema } from './manifest';

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
});
