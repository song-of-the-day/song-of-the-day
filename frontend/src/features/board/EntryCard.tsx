import { StickyNote } from 'lucide-react';
import { useId } from 'react';

import type { Entry } from '@/api/types';
import { Artwork, DateStamp } from '@/components/entry';
import { joinIds } from '@/components/ui/field';
import { cn } from '@/lib/cn';
import type { CardStyle } from '@/lib/theme';

import { notesLabel, openEntryLabel } from './entryLabel';

export interface EntryCardProps {
  entry: Entry;
  /** The theme's card style. */
  cardStyle: CardStyle;
  /** Opens the entry's dialog. */
  onOpen: (entryId: number) => void;
}

/** A date stamp flattened into a line of text (title bars and captions). */
const PLAIN_STAMP = 'rotate-0 border-0 bg-transparent p-0';

const FRAMES: Record<CardStyle, string> = {
  window: 'y2k-window y2k-lift',
  polaroid: 'y2k-polaroid y2k-lift',
  minimal: 'border border-line bg-surface p-2 hover:border-muted',
};

interface CardPartsProps {
  entry: Entry;
  noteId: string;
  countId: string;
}

function TitleAndArtist({ entry, className }: { entry: Entry; className?: string }) {
  return (
    <span className={cn('block min-w-0', className)}>
      <span className="block truncate text-sm font-semibold text-fg">{entry.title}</span>
      <span className="block truncate text-sm text-muted">{entry.artist}</span>
    </span>
  );
}

function WindowCard({ entry, noteId, countId }: CardPartsProps) {
  return (
    <>
      <span className="y2k-titlebar">
        <span className="y2k-dots" aria-hidden="true" />
        <DateStamp date={entry.entry_date} className={cn(PLAIN_STAMP, 'mr-auto')} />
        {entry.annotation_count > 0 && (
          <span id={countId} className="flex items-center gap-1 font-body text-xs text-muted">
            <StickyNote aria-hidden="true" className="size-3.5" />
            <span aria-hidden="true">{entry.annotation_count}</span>
            <span className="sr-only">{notesLabel(entry.annotation_count)}</span>
          </span>
        )}
      </span>
      <span className="block p-2">
        <Artwork src={entry.artwork_url} title={entry.title} artist={entry.artist} size="fill" />
        <TitleAndArtist entry={entry} className="mt-2" />
        {entry.note !== null && entry.note !== '' && (
          <span id={noteId} className="mt-1 line-clamp-2 text-sm break-words text-fg">
            {entry.note}
          </span>
        )}
      </span>
    </>
  );
}

function PolaroidCard({ entry }: CardPartsProps) {
  return (
    <>
      <Artwork src={entry.artwork_url} title={entry.title} artist={entry.artist} size="fill" />
      <span className="y2k-polaroid-caption block">
        <TitleAndArtist entry={entry} />
        <DateStamp date={entry.entry_date} className={cn(PLAIN_STAMP, 'mt-1 text-muted')} />
      </span>
    </>
  );
}

function MinimalCard({ entry }: CardPartsProps) {
  return (
    <>
      <Artwork src={entry.artwork_url} title={entry.title} artist={entry.artist} size="fill" />
      <TitleAndArtist entry={entry} className="mt-2" />
      <DateStamp date={entry.entry_date} className={cn(PLAIN_STAMP, 'mt-0.5 text-muted')} />
    </>
  );
}

const BODIES = { window: WindowCard, polaroid: PolaroidCard, minimal: MinimalCard } as const;

/**
 * One board card in the theme's style: a *window* with a date-stamped title
 * bar, a note excerpt and a notes badge; a *polaroid* with a caption under the art; or *minimal*
 * art and text. The whole card is one button named after the song and date; the note excerpt and
 * notes count are its description.
 */
export function EntryCard({ entry, cardStyle, onOpen }: EntryCardProps) {
  const noteId = useId();
  const countId = useId();
  const Body = BODIES[cardStyle];
  const hasNote = cardStyle === 'window' && entry.note !== null && entry.note !== '';
  const hasCount = cardStyle === 'window' && entry.annotation_count > 0;

  return (
    <button
      type="button"
      aria-label={openEntryLabel(entry)}
      aria-describedby={joinIds(hasCount && countId, hasNote && noteId)}
      data-card-style={cardStyle}
      className={cn('block w-full cursor-pointer text-left', FRAMES[cardStyle])}
      onClick={() => {
        onOpen(entry.id);
      }}
    >
      <Body entry={entry} noteId={noteId} countId={countId} />
    </button>
  );
}
