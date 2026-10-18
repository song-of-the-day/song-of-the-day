import { describe, expect, it } from 'vitest';

import { readResetToken } from './resetToken';

describe('readResetToken', () => {
  it('reads the token from the fragment', () => {
    expect(readResetToken('#token=eyJ1aWQiOjF9.Zx1-ab_c')).toBe('eyJ1aWQiOjF9.Zx1-ab_c');
    expect(readResetToken('token=abc')).toBe('abc');
    expect(readResetToken('#other=1&token=%20abc%20')).toBe('abc');
  });

  it('is null when the token is missing or empty', () => {
    expect(readResetToken('')).toBeNull();
    expect(readResetToken('#')).toBeNull();
    expect(readResetToken('#token=')).toBeNull();
    expect(readResetToken('#tok=abc')).toBeNull();
  });
});
