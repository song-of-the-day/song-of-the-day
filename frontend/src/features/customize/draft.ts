/**
 * The customize sheet's draft: what is edited, how it compares with the saved profile, and how
 * hex text input is read.
 */
import type { User } from '@/api/types';
import { isHexColor, normalizeHex } from '@/lib/color';
import { COLOR_ROLES, themesEqual, type ColorRole, type Theme } from '@/lib/theme';

/** The profile fields the sheet edits (the username is changed in the account dialog). */
export interface ProfileDraft {
  display_name: string;
  bio: string;
  theme: Theme;
}

/** The text in each color's hex field (may be invalid while the user types). */
export type HexText = Record<ColorRole, string>;

/** Maximum bio length (API: 0–280 characters). */
export const BIO_MAX_LENGTH = 280;

/**
 * API field paths the sheet can show a message for, in display order (focus moves to the first).
 * They match the dotted keys of a `422 validation_error`.
 */
export const DRAFT_FIELDS = [
  'theme.colors.background',
  'theme.colors.surface',
  'theme.colors.text',
  'theme.colors.accent',
  'theme.colors.border',
  'theme.fonts.heading',
  'theme.fonts.body',
  'theme.background.image_upload_id',
  'display_name',
  'bio',
] as const;

export type DraftField = (typeof DRAFT_FIELDS)[number];

/**
 * Names a color's API field.
 *
 * @param role - The color role.
 * @returns E.g. `theme.colors.text`.
 */
export function colorField(role: ColorRole): DraftField {
  return `theme.colors.${role}`;
}

/**
 * Snapshots the editable fields of a user.
 *
 * @param user - The logged-in user.
 * @returns A draft equal to the saved profile.
 */
export function draftFromUser(user: User): ProfileDraft {
  return {
    display_name: user.display_name,
    bio: user.bio,
    theme: user.theme,
  };
}

/**
 * Builds the hex field texts for a theme.
 *
 * @param theme - The theme.
 * @returns Each color as upper-case `#RRGGBB`.
 */
export function hexTextOf(theme: Theme): HexText {
  const text: Partial<HexText> = {};
  for (const role of COLOR_ROLES) {
    text[role] = normalizeHex(theme.colors[role]);
  }
  return text as HexText;
}

/**
 * Reads a hex field: `#RRGGBB`, case-insensitive, with optional surrounding spaces and an
 * optional leading `#`.
 *
 * @param text - What the user typed.
 * @returns The color as upper-case `#RRGGBB`, or `null` when the text isn't a color.
 */
export function parseHexInput(text: string): string | null {
  const trimmed = text.trim();
  const value = trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
  return isHexColor(value) ? normalizeHex(value) : null;
}

/**
 * Lists the colors whose hex field doesn't hold a valid color.
 *
 * @param hexText - The hex field texts.
 * @returns The invalid roles, in display order.
 */
export function invalidColorRoles(hexText: HexText): ColorRole[] {
  return COLOR_ROLES.filter((role) => parseHexInput(hexText[role]) === null);
}

/**
 * Compares a draft with the saved profile.
 *
 * @param draft - The edited fields.
 * @param saved - The fields when the sheet opened.
 * @returns Whether saving would change anything.
 */
export function isDraftChanged(draft: ProfileDraft, saved: ProfileDraft): boolean {
  return (
    draft.display_name !== saved.display_name ||
    draft.bio !== saved.bio ||
    !themesEqual(draft.theme, saved.theme)
  );
}
