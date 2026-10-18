import { describe, expect, it } from 'vitest';

import { cn } from './cn';

describe('cn', () => {
  it('joins class names and skips falsy values', () => {
    const when = (condition: boolean, name: string) => condition && name;
    expect(cn('a', when(false, 'b'), null, undefined, '', when(true, 'c'))).toBe('a c');
  });

  it('returns an empty string for no classes', () => {
    expect(cn()).toBe('');
  });
});
