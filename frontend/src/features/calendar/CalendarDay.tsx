import { Plus } from 'lucide-react';
import type { KeyboardEvent } from 'react';

import type { Entry } from '@/api/types';
import { Artwork } from '@/components/entry';
import { openEntryLabel, spokenDate } from '@/features/board/entryLabel';
import { cn } from '@/lib/cn';

export interface CalendarDayProps {
  /** The day, `yyyy-MM-dd`. */
  date: string;
  /** The day's entry, if it has one. */
  entry: Entry | undefined;
  /** Whether the day can be opened or logged (on or before today, with the month loaded). */
  interactive: boolean;
  isToday: boolean;
  /** The roving tab stop: `0` for the one day the grid's Tab lands on. */
  tabIndex: 0 | -1;
  onOpenEntry: (entryId: number) => void;
  /** Logs a song for this empty day; without it the empty day is inert. */
  onLogDate?: (date: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>, date: string) => void;
  onFocus: (date: string) => void;
}

const CELL =
  'relative flex aspect-square w-full items-start justify-start overflow-hidden rounded-sm border text-xs sm:text-sm';
/** Today's dashed accent outline; a focused today still gets the solid focus ring. */
const TODAY =
  'outline-2 -outline-offset-2 outline-accent outline-dashed focus-visible:outline-offset-2 focus-visible:outline-solid';
const DAY_NUMBER_CHIP = 'absolute top-0.5 left-0.5 rounded-sm bg-surface/90 px-1 leading-4 text-fg';

/**
 * One day of the month grid. A logged day shows its artwork and opens the entry; an empty day on
 * or before today logs a song for that date; future days (and every day while the month loads)
 * are inert.
 */
export function CalendarDay({
  date,
  entry,
  interactive,
  isToday,
  tabIndex,
  onOpenEntry,
  onLogDate,
  onKeyDown,
  onFocus,
}: CalendarDayProps) {
  const day = String(Number(date.slice(8)));
  const todayClass = isToday && TODAY;

  const inert = (
    <span
      aria-current={isToday ? 'date' : undefined}
      className={cn(CELL, 'border-line p-1 text-muted', todayClass)}
    >
      {day}
    </span>
  );
  if (!interactive) {
    return inert;
  }

  const buttonProps = {
    type: 'button' as const,
    'data-date': date,
    tabIndex,
    'aria-current': isToday ? ('date' as const) : undefined,
    onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => {
      onKeyDown(event, date);
    },
    onFocus: () => {
      onFocus(date);
    },
  };

  if (entry !== undefined) {
    return (
      <button
        {...buttonProps}
        aria-label={openEntryLabel(entry)}
        className={cn(CELL, 'cursor-pointer border-muted p-0', todayClass)}
        onClick={() => {
          onOpenEntry(entry.id);
        }}
      >
        <Artwork src={entry.artwork_url} title={entry.title} artist={entry.artist} size="fill" />
        <span aria-hidden="true" className={DAY_NUMBER_CHIP}>
          {day}
        </span>
      </button>
    );
  }

  if (onLogDate === undefined) {
    return inert;
  }
  return (
    <button
      {...buttonProps}
      aria-label={`Log a song for ${spokenDate(date)}`}
      className={cn(
        CELL,
        'group cursor-pointer border-muted bg-surface p-1 text-fg hover:bg-fg/5',
        todayClass,
      )}
      onClick={() => {
        onLogDate(date);
      }}
    >
      <span aria-hidden="true">{day}</span>
      <Plus
        aria-hidden="true"
        className="absolute inset-0 m-auto size-4 text-muted opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"
      />
    </button>
  );
}
