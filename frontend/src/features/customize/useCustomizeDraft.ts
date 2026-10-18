/**
 * Draft state for the customize sheet, with every theme change reported for the live preview.
 */
import { useState } from 'react';

import type { User } from '@/api/types';
import { normalizeHex } from '@/lib/color';
import {
  applyPreset,
  withField,
  type ColorRole,
  type PresetKey,
  type Theme,
  type ThemeEdit,
} from '@/lib/theme';

import {
  draftFromUser,
  hexTextOf,
  invalidColorRoles,
  isDraftChanged,
  parseHexInput,
  type HexText,
  type ProfileDraft,
} from './draft';

export interface CustomizeDraft {
  /** The profile as it was when the sheet opened. */
  saved: ProfileDraft;
  draft: ProfileDraft;
  /** The text of each color's hex field. */
  hexText: HexText;
  /** Colors whose hex field doesn't hold a valid color. */
  invalidColors: ColorRole[];
  /** Whether closing would lose anything (including hex text that isn't a color yet). */
  changed: boolean;
  applyPreset: (key: PresetKey) => void;
  /** Sets a color from the native picker. */
  setColor: (role: ColorRole, hex: string) => void;
  /** Updates a hex field; the color changes as soon as the text is a valid color. */
  setHexText: (role: ColorRole, text: string) => void;
  /** Rewrites a valid hex field as upper-case `#RRGGBB` (on blur). */
  normalizeHexText: (role: ColorRole) => void;
  editTheme: (edit: ThemeEdit) => void;
  setDisplayName: (value: string) => void;
  setBio: (value: string) => void;
}

/**
 * Holds the draft for one opening of the sheet. Mount it when the sheet opens: the saved state is
 * captured from `user` on mount.
 *
 * @param user - The logged-in user.
 * @param onThemeChange - Called with the new draft theme after every theme change.
 * @returns The draft and its editing operations.
 */
export function useCustomizeDraft(
  user: User,
  onThemeChange: (theme: Theme) => void,
): CustomizeDraft {
  const [saved] = useState(() => draftFromUser(user));
  const [draft, setDraft] = useState(saved);
  const [hexText, setHexTextState] = useState(() => hexTextOf(saved.theme));
  const invalidColors = invalidColorRoles(hexText);

  function updateTheme(theme: Theme, nextHexText: HexText = hexTextOf(theme)) {
    setDraft({ ...draft, theme });
    setHexTextState(nextHexText);
    onThemeChange(theme);
  }

  function changeColor(role: ColorRole, color: string, text: string) {
    const nextHexText = { ...hexText, [role]: text };
    if (color === normalizeHex(draft.theme.colors[role])) {
      setHexTextState(nextHexText);
      return;
    }
    updateTheme(withField(draft.theme, { colors: { [role]: color } }), nextHexText);
  }

  return {
    saved,
    draft,
    hexText,
    invalidColors,
    changed: isDraftChanged(draft, saved) || invalidColors.length > 0,
    applyPreset: (key) => {
      updateTheme(applyPreset(draft.theme, key));
    },
    setColor: (role, hex) => {
      const color = normalizeHex(hex);
      changeColor(role, color, color);
    },
    setHexText: (role, text) => {
      const color = parseHexInput(text);
      if (color === null) {
        setHexTextState({ ...hexText, [role]: text });
        return;
      }
      changeColor(role, color, text);
    },
    normalizeHexText: (role) => {
      const color = parseHexInput(hexText[role]);
      if (color !== null && color !== hexText[role]) {
        setHexTextState({ ...hexText, [role]: color });
      }
    },
    editTheme: (edit) => {
      updateTheme(withField(draft.theme, edit), hexText);
    },
    setDisplayName: (value) => {
      setDraft({ ...draft, display_name: value });
    },
    setBio: (value) => {
      setDraft({ ...draft, bio: value });
    },
  };
}
