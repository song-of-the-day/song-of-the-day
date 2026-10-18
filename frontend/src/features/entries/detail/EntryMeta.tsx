import type { ReactNode } from 'react';

import type { EntryDetail } from '@/api/types';
import { Artwork, DateStamp } from '@/components/entry';

export interface EntryMetaProps {
  entry: EntryDetail;
  /** Extra content under the meta: the "Listen on" row, shown in view mode only. */
  listenOn?: ReactNode;
}

/**
 * The song's artwork, title, artist, album and date stamp, with room for the "Listen on" row.
 * Beside the artwork on phones; stacked under full-width artwork in the dialog's side column on
 * wider screens.
 */
export function EntryMeta({ entry, listenOn }: EntryMetaProps) {
  return (
    <div className="flex min-w-0 items-start gap-4 md:flex-col">
      <div className="w-28 shrink-0 sm:w-36 md:w-full">
        <Artwork src={entry.artwork_url} title={entry.title} artist={entry.artist} size="fill" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col items-start gap-1">
        <h3 className="font-body text-xl leading-tight font-semibold break-words text-fg sm:text-2xl">
          {entry.title}
        </h3>
        <p className="text-base break-words text-fg">{entry.artist}</p>
        {entry.album !== null && <p className="text-sm break-words text-muted">{entry.album}</p>}
        <DateStamp date={entry.entry_date} className="mt-2" />
        {listenOn !== undefined && <div className="mt-2 w-full">{listenOn}</div>}
      </div>
    </div>
  );
}
