import { EntryDetailWindow } from './detail/EntryDetailWindow';

export interface EntryDetailDialogProps {
  /** The profile the entry belongs to (normalized). */
  username: string;
  /** The entry to show; `null` = closed. */
  entryId: number | null;
  onClose: () => void;
  /** Visitor mode: no Edit/Delete, no note editing, no YouTube-link form. */
  readOnly: boolean;
}

/**
 * Shows one entry with its player, notes and (for the owner) actions.
 * Each entry id gets a fresh dialog, so nothing (player, open forms) carries over between
 * entries. The player auto-plays on open for a logged-in viewer whose preference allows it.
 */
export function EntryDetailDialog({
  username,
  entryId,
  onClose,
  readOnly,
}: EntryDetailDialogProps) {
  if (entryId === null) {
    return null;
  }
  return (
    <EntryDetailWindow
      key={`${username}/${String(entryId)}`}
      username={username}
      entryId={entryId}
      onClose={onClose}
      readOnly={readOnly}
    />
  );
}
