/**
 * Request bodies built by the log dialog: create, edit (changed fields only) and "Replace it".
 */
import type { Entry, EntryCreateInput, EntryPatch } from '@/api/types';

import { sameSong, SONG_FIELDS, songFromEntry, type SongDraft } from './songDraft';
import type { EntryDetails } from './validation';

/** Whether the entry has a video that belongs to a different song than `song`. */
function hasOtherSongsVideo(entry: Entry | undefined, song: SongDraft): boolean {
  if (entry === undefined) {
    return false;
  }
  return entry.youtube_video_id !== null && !sameSong(songFromEntry(entry), song);
}

/**
 * Builds the body of `POST /api/entries`.
 *
 * @param song - The chosen song.
 * @param details - The validated details.
 * @returns The create payload.
 */
export function buildCreateInput(song: SongDraft, details: EntryDetails): EntryCreateInput {
  return {
    entry_date: details.entry_date,
    ...song,
    note: details.note,
    youtube_video_id: details.youtube_video_id,
  };
}

/**
 * Builds the PATCH for an edited entry with only the fields that changed.
 *
 * @param entry - The entry as loaded.
 * @param song - The song now chosen.
 * @param details - The validated details.
 * @returns The changed fields (empty when nothing changed).
 */
export function buildEditPatch(entry: Entry, song: SongDraft, details: EntryDetails): EntryPatch {
  const patch: EntryPatch = {};
  for (const field of SONG_FIELDS) {
    if (song[field] !== entry[field]) {
      Object.assign(patch, { [field]: song[field] });
    }
  }
  if (details.entry_date !== entry.entry_date) {
    patch.entry_date = details.entry_date;
  }
  if (details.note !== entry.note) {
    patch.note = details.note;
  }
  if (details.youtube_video_id !== entry.youtube_video_id) {
    patch.youtube_video_id = details.youtube_video_id;
  }
  return patch;
}

/**
 * Builds the PATCH for "Replace it" after `409 entry_exists`: the day's entry gets the new song,
 * and the note and YouTube link only when they were filled in. A video attached to a different
 * song is cleared, since it no longer matches.
 *
 * @param song - The new song.
 * @param details - The validated details.
 * @param existing - The entry being replaced, if it has loaded.
 * @returns The PATCH body.
 */
export function buildReplacePatch(
  song: SongDraft,
  details: EntryDetails,
  existing: Entry | undefined,
): EntryPatch {
  const patch: EntryPatch = { ...song };
  if (details.note !== null) {
    patch.note = details.note;
  }
  if (details.youtube_video_id !== null) {
    patch.youtube_video_id = details.youtube_video_id;
  } else if (hasOtherSongsVideo(existing, song)) {
    patch.youtube_video_id = null;
  }
  return patch;
}
