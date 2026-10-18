import { describe, expect, it } from 'vitest';

import { ApiError } from '@/api/errors';

import {
  apiFieldErrors,
  compactErrors,
  firstInvalidField,
  PASSWORD_HINT,
  validateDisplayName,
  validateEmail,
  validateNewPassword,
} from './validation';

describe('validateEmail', () => {
  it('accepts a trimmed address', () => {
    expect(validateEmail('  ada@example.com ')).toBeUndefined();
  });

  it('requires an address', () => {
    expect(validateEmail('   ')).toBe('Enter your email address.');
  });

  it.each(['ada', 'ada@', '@example.com', 'ada@example', 'a da@example.com'])(
    'rejects "%s"',
    (value) => {
      expect(validateEmail(value)).toBe('Enter a valid email address.');
    },
  );

  it('rejects addresses over 320 characters', () => {
    expect(validateEmail(`${'a'.repeat(310)}@example.com`)).toBe('Enter a valid email address.');
  });

  it('counts code points like the API', () => {
    // 300 astral characters are 600 UTF-16 units but 300 characters for the API.
    expect(validateEmail(`${'𝒶'.repeat(300)}@example.com`)).toBeUndefined();
    expect(validateEmail(`${'𝒶'.repeat(309)}@example.com`)).toBe('Enter a valid email address.');
  });
});

describe('validateNewPassword', () => {
  it('describes the policy in the hint', () => {
    expect(PASSWORD_HINT).toBe('Use 8–128 characters.');
  });

  it('accepts 8 to 128 characters, untrimmed', () => {
    expect(validateNewPassword(' secret1 ')).toBeUndefined();
    expect(validateNewPassword('x'.repeat(128))).toBeUndefined();
  });

  it('requires a password of the right length', () => {
    expect(validateNewPassword('')).toBe('Enter a password.');
    expect(validateNewPassword('short')).toBe('Use at least 8 characters.');
    expect(validateNewPassword('x'.repeat(129))).toBe('Use at most 128 characters.');
  });

  it('counts code points like the API', () => {
    expect(validateNewPassword('🎵'.repeat(7))).toBe('Use at least 8 characters.');
    expect(validateNewPassword('🎵'.repeat(8))).toBeUndefined();
  });

  it('rejects passwords made only of whitespace', () => {
    expect(validateNewPassword(' '.repeat(8))).toBe("A password can't be only spaces.");
  });
});

describe('validateDisplayName', () => {
  it('accepts 1 to 50 characters after trimming', () => {
    expect(validateDisplayName(' Ada ')).toBeUndefined();
    expect(validateDisplayName('x'.repeat(50))).toBeUndefined();
  });

  it('rejects empty and long names', () => {
    expect(validateDisplayName('  ')).toBe('Enter a display name.');
    expect(validateDisplayName('x'.repeat(51))).toBe('Use at most 50 characters.');
  });
});

describe('error helpers', () => {
  it('drops fields without errors', () => {
    expect(compactErrors({ email: 'Bad.', password: undefined })).toEqual({ email: 'Bad.' });
  });

  it("picks the API's field errors for known fields", () => {
    const error = new ApiError({
      status: 422,
      code: 'validation_error',
      message: 'Some fields are invalid.',
      fields: { email: 'Enter a valid email address.', remember: 'Must be a boolean.' },
    });

    expect(apiFieldErrors(error, ['email', 'password'] as const)).toEqual({
      email: 'Enter a valid email address.',
    });
    expect(apiFieldErrors(new Error('x'), ['email'] as const)).toEqual({});
  });

  it('finds the first invalid field in form order', () => {
    const order = ['display_name', 'email', 'password'] as const;

    expect(firstInvalidField({ password: 'x', email: 'y' }, order)).toBe('email');
    expect(firstInvalidField({}, order)).toBeUndefined();
  });
});
