/**
 * Copy for the entry dialog.
 */

/**
 * Builds the delete confirmation.
 *
 * @param noteCount - The entry's annotation count.
 * @returns E.g. "Delete this day's song and its 3 notes?".
 */
export function deleteEntryMessage(noteCount: number): string {
  if (noteCount === 0) {
    return "Delete this day's song?";
  }
  return `Delete this day's song and its ${String(noteCount)} ${noteCount === 1 ? 'note' : 'notes'}?`;
}
