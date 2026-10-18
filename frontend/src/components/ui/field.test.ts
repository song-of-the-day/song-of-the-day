import { describe, expect, it } from 'vitest';

import { hasContent, joinIds } from './field';

describe('field helpers', () => {
  it('joins ids, skipping empty values', () => {
    expect(joinIds('a', undefined, false, '', null, 'b')).toBe('a b');
    expect(joinIds(undefined, false)).toBeUndefined();
  });

  it('detects whether a hint or error was given', () => {
    expect(hasContent('Required')).toBe(true);
    expect(hasContent(0)).toBe(true);
    expect(hasContent('')).toBe(false);
    expect(hasContent(null)).toBe(false);
    expect(hasContent(undefined)).toBe(false);
    expect(hasContent(false)).toBe(false);
  });
});
