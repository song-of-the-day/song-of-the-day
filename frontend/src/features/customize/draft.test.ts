import { describe, expect, it } from 'vitest';

import { defaultTheme, withField } from '@/lib/theme';
import { makeUser } from '@/test/fixtures';

import {
  colorField,
  draftFromUser,
  hexTextOf,
  invalidColorRoles,
  isDraftChanged,
  parseHexInput,
} from './draft';

describe('parseHexInput', () => {
  it.each([
    ['#5b4bff', '#5B4BFF'],
    ['5B4BFF', '#5B4BFF'],
    ['  #00ff00 ', '#00FF00'],
  ])('reads %j as %s', (text, color) => {
    expect(parseHexInput(text)).toBe(color);
  });

  it.each(['', '#', '#abc', '#12345G', '##123456', '#1234567', 'blue'])('rejects %j', (text) => {
    expect(parseHexInput(text)).toBeNull();
  });
});

describe('draft helpers', () => {
  it('snapshots the editable profile fields', () => {
    const user = makeUser({ display_name: 'Ada', bio: 'hi' });
    expect(draftFromUser(user)).toEqual({
      display_name: 'Ada',
      bio: 'hi',
      theme: user.theme,
    });
  });

  it('builds upper-case hex texts and finds invalid ones', () => {
    const theme = withField(defaultTheme(), { colors: { accent: '#abcdef' } });
    const text = hexTextOf(theme);
    expect(text.accent).toBe('#ABCDEF');
    expect(invalidColorRoles(text)).toEqual([]);
    expect(invalidColorRoles({ ...text, surface: '#12', border: 'x' })).toEqual([
      'surface',
      'border',
    ]);
  });

  it('detects changes to any field', () => {
    const saved = draftFromUser(makeUser());
    expect(isDraftChanged({ ...saved }, saved)).toBe(false);
    expect(isDraftChanged({ ...saved, display_name: 'Bo' }, saved)).toBe(true);
    expect(isDraftChanged({ ...saved, bio: 'new' }, saved)).toBe(true);
    expect(
      isDraftChanged({ ...saved, theme: withField(saved.theme, { card_style: 'minimal' }) }, saved),
    ).toBe(true);
  });

  it('names color fields like the API', () => {
    expect(colorField('text')).toBe('theme.colors.text');
  });
});
