import { useMemo, useRef, useState, type KeyboardEvent } from 'react';

import type { Entry } from '@/api/types';
import { monthGrid } from '@/lib/dates';

import { CalendarDay } from './CalendarDay';
import { initialFocusDate, nextFocusDate } from './calendarNavigation';

export interface CalendarGridProps {
  /** The month, `yyyy-MM`. */
  month: string;
  today: string;
  /** The month's entries by date. */
  entries: ReadonlyMap<string, Entry>;
  /** Whether the month's entries have loaded (days stay inert until then). */
  loaded: boolean;
  /** The id of the month title that names the grid. */
  labelledBy: string;
  onOpenEntry: (entryId: number) => void;
  /** Logs a song for an empty day; without it (visitor mode) empty days are inert. */
  onLogDate?: (date: string) => void;
}

const WEEKDAYS = [
  ['Sun', 'Sunday'],
  ['Mon', 'Monday'],
  ['Tue', 'Tuesday'],
  ['Wed', 'Wednesday'],
  ['Thu', 'Thursday'],
  ['Fri', 'Friday'],
  ['Sat', 'Saturday'],
] as const;

/**
 * The month as a 7-column grid of square days, weeks starting on Sunday. The days that can be
 * opened or logged (only logged days in visitor mode) share one tab stop: the arrow keys move by day and week, Home and End jump to
 * the first and last of them.
 */
export function CalendarGrid({
  month,
  today,
  entries,
  loaded,
  labelledBy,
  onOpenEntry,
  onLogDate,
}: CalendarGridProps) {
  const gridRef = useRef<HTMLTableElement>(null);
  const weeks = useMemo(() => monthGrid(month), [month]);
  const canLog = onLogDate !== undefined;
  const focusable = useMemo(
    () =>
      loaded
        ? weeks
            .flat()
            .filter(
              (date): date is string =>
                date !== null && date <= today && (canLog || entries.has(date)),
            )
        : [],
    [weeks, loaded, today, canLog, entries],
  );
  const [focusedDate, setFocusedDate] = useState<string | null>(null);
  const tabStop =
    focusedDate !== null && focusable.includes(focusedDate)
      ? focusedDate
      : initialFocusDate(focusable, today);

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, date: string) {
    const target = nextFocusDate(event.key, date, focusable);
    if (target === null) {
      return;
    }
    event.preventDefault();
    setFocusedDate(target);
    gridRef.current?.querySelector<HTMLElement>(`[data-date="${target}"]`)?.focus();
  }

  return (
    <table
      ref={gridRef}
      role="grid"
      aria-labelledby={labelledBy}
      aria-busy={!loaded || undefined}
      className="w-full table-fixed border-separate border-spacing-1 sm:border-spacing-1.5"
    >
      <thead>
        <tr>
          {WEEKDAYS.map(([short, long]) => (
            <th
              key={long}
              scope="col"
              abbr={long}
              className="pb-1 text-center text-xs font-medium text-muted"
            >
              {short}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {weeks.map((week) => (
          <tr key={week.find((date) => date !== null) ?? ''}>
            {week.map((date, index) => (
              <td key={date ?? `blank-${String(index)}`} role="gridcell" className="p-0">
                {date !== null && (
                  <CalendarDay
                    date={date}
                    entry={entries.get(date)}
                    interactive={focusable.includes(date)}
                    isToday={date === today}
                    tabIndex={date === tabStop ? 0 : -1}
                    onOpenEntry={onOpenEntry}
                    onLogDate={onLogDate}
                    onKeyDown={handleKeyDown}
                    onFocus={setFocusedDate}
                  />
                )}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
