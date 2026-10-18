import { useProfileEntry } from '@/api/hooks/users';
import type { Entry } from '@/api/types';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';

import { alreadyLoggedMessage, notesStayAttachedMessage } from './messages';
import { sameSong, songFromEntry, type SongDraft } from './songDraft';

export interface EntryConflictProps {
  /** The logged-in owner's username. */
  username: string;
  /** The entry that already holds the day (`existing_entry_id`). */
  entryId: number;
  /** The day, as the dialog names it (e.g. "Sun, Oct 11"). */
  day: string;
  /** The song that would replace it, or `null` when replacing isn't offered (edit mode). */
  replacement?: SongDraft | null;
  /** Whether "Replace it" is running. */
  replacing?: boolean;
  onOpen: () => void;
  /** Replaces the day's song; receives the existing entry once it has loaded. */
  onReplace?: (existing: Entry | undefined) => void;
}

/**
 * Explains a `409 entry_exists` — "You already logged <title> for <date>." — with [Open it] and,
 * when creating, [Replace it]. Loads the existing entry to name its song.
 */
export function EntryConflict({
  username,
  entryId,
  day,
  replacement = null,
  replacing = false,
  onOpen,
  onReplace,
}: EntryConflictProps) {
  const existing = useProfileEntry(username, entryId).data;
  const notesWarning =
    replacement !== null &&
    existing !== undefined &&
    existing.annotation_count > 0 &&
    !sameSong(songFromEntry(existing), replacement);

  return (
    <Alert tone="error" title={alreadyLoggedMessage(existing?.title, day)}>
      {notesWarning && <p>{notesStayAttachedMessage(existing.annotation_count)}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={onOpen}>
          Open it
        </Button>
        {replacement !== null && onReplace !== undefined && (
          <Button
            size="sm"
            loading={replacing}
            onClick={() => {
              onReplace(existing);
            }}
          >
            Replace it
          </Button>
        )}
      </div>
    </Alert>
  );
}
