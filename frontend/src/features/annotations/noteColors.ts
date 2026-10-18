/**
 * Sticky-note colors from `shared/theme-options.json`.
 */
import type { CSSProperties } from 'react';

import { noteColorOptions, type NoteColorKey, type NoteColorOption } from '@/lib/theme';

/** Inline style that sets a note's color for the `y2k-note` and `bg-(--y2k-note-color)` styles. */
export type NoteColorStyle = CSSProperties & { '--y2k-note-color': string };

function noteColor(key: NoteColorKey): NoteColorOption {
  const option = noteColorOptions.find((candidate) => candidate.key === key);
  if (option === undefined) {
    throw new Error(`Unknown note color "${key}"`);
  }
  return option;
}

/**
 * Builds the inline style that colors a note.
 *
 * @param key - The note color.
 * @returns A style setting `--y2k-note-color` to the color's hex value.
 */
export function noteColorStyle(key: NoteColorKey): NoteColorStyle {
  return { '--y2k-note-color': noteColor(key).hex };
}
