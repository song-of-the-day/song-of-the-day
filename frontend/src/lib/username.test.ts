import rawUsernameRules from '@shared/usernames.json';
import { describe, expect, it } from 'vitest';

import {
  isValidUsername,
  normalizeUsername,
  parseUsernameRules,
  profileUrl,
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
  usernameTakenMessage,
  validateUsername,
} from './username';

const MESSAGES = rawUsernameRules.messages;
const LENGTH_MESSAGE = 'Username must be between 3 and 30 characters.';

describe('username rules', () => {
  it('reads the limits and the messages from the shared file', () => {
    expect(USERNAME_MIN_LENGTH).toBe(rawUsernameRules.min_length);
    expect(USERNAME_MAX_LENGTH).toBe(rawUsernameRules.max_length);
  });

  it('rejects a malformed rules file', () => {
    expect(() => parseUsernameRules(null)).toThrow('expected an object');
    expect(() => parseUsernameRules({ ...rawUsernameRules, reserved: [1] })).toThrow(
      'invalid rules',
    );
    expect(() => parseUsernameRules({ ...rawUsernameRules, pattern: 3 })).toThrow('invalid rules');
    expect(() => parseUsernameRules({ ...rawUsernameRules, messages: {} })).toThrow(
      'invalid rules',
    );
  });

  it('normalizes by trimming and lower-casing', () => {
    expect(normalizeUsername('  Ada_Lovelace ')).toBe('ada_lovelace');
  });

  it('accepts valid usernames, normalized first', () => {
    expect(validateUsername('ada')).toBeUndefined();
    expect(validateUsername(' Ada-99 ')).toBeUndefined();
    expect(validateUsername('a'.repeat(30))).toBeUndefined();
    expect(isValidUsername('night_owl')).toBe(true);
  });

  it.each([
    ['', LENGTH_MESSAGE],
    ['   ', LENGTH_MESSAGE],
    ['ab', LENGTH_MESSAGE],
    ['a'.repeat(31), LENGTH_MESSAGE],
    ['-ada', MESSAGES.pattern],
    ['ada_', MESSAGES.pattern],
    ['ad a', MESSAGES.pattern],
    ['adé', MESSAGES.pattern],
    ['profile', 'Username profile is unavailable.'],
    ['Login', 'Username login is unavailable.'],
    ['forgot-password', 'Username forgot-password is unavailable.'],
  ])('rejects %j', (value, message) => {
    expect(validateUsername(value)).toBe(message);
    expect(isValidUsername(value)).toBe(false);
  });

  it('builds the taken message the API uses, from the normalized name', () => {
    expect(usernameTakenMessage('ADA')).toBe('Username ada is already taken.');
    expect(usernameTakenMessage('ada')).toBe(MESSAGES.taken.replace('{username}', 'ada'));
  });

  it('reserves every top-level route of the app', () => {
    for (const route of ['login', 'signup', 'forgot-password', 'reset-password', 'profile']) {
      expect(rawUsernameRules.reserved).toContain(route);
    }
  });

  it('builds the profile URL', () => {
    expect(profileUrl('ada', 'https://sotd.example')).toBe('https://sotd.example/ada');
    expect(profileUrl('ada')).toBe(`${window.location.origin}/ada`);
  });
});
