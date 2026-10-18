import { useId, useMemo } from 'react';

import { useProfileEntriesRange } from '@/api/hooks/users';
import type { Entry } from '@/api/types';
import { RetryAlert } from '@/features/board/RetryAlert';
import { monthKeyOf, monthRange } from '@/lib/dates';

import { CalendarGrid } from './CalendarGrid';
import { CalendarHeader } from './CalendarHeader';

export interface CalendarViewProps {
  /** The profile's (normalized) username. */
  username: string;
  /** Visitor mode: empty days are inert. */
  readOnly: boolean;
  /** The displayed month, `yyyy-MM`. */
  month: string;
  /** Today's date, `yyyy-MM-dd`. */
  today: string;
  onMonthChange: (month: string) => void;
  /** Opens a logged day's entry. */
  onOpenEntry: (entryId: number) => void;
  /** Opens the log dialog for an empty day. */
  onLogDate: (date: string) => void;
}

const NO_ENTRIES: readonly Entry[] = [];

/**
 * The Calendar view: a surface panel with the month header and the month
 * grid, loading that month's entries.
 */
export function CalendarView({
  username,
  readOnly,
  month,
  today,
  onMonthChange,
  onOpenEntry,
  onLogDate,
}: CalendarViewProps) {
  const titleId = useId();
  const { start, end } = monthRange(month);
  const range = useProfileEntriesRange(username, start, end);
  const entries = range.data ?? NO_ENTRIES;
  const byDate = useMemo(
    () => new Map(entries.map((entry) => [entry.entry_date, entry])),
    [entries],
  );

  return (
    <section aria-labelledby={titleId} className="y2k-window">
      <CalendarHeader
        titleId={titleId}
        month={month}
        currentMonth={monthKeyOf(today)}
        onMonthChange={onMonthChange}
      />
      <div className="flex flex-col gap-3 p-1.5 sm:p-4">
        {range.data === undefined && range.isError && (
          <RetryAlert
            title="Couldn't load this month."
            error={range.error}
            retrying={range.isFetching}
            onRetry={() => {
              void range.refetch();
            }}
          />
        )}
        <CalendarGrid
          month={month}
          today={today}
          entries={byDate}
          loaded={range.data !== undefined}
          labelledBy={titleId}
          onOpenEntry={onOpenEntry}
          onLogDate={readOnly ? undefined : onLogDate}
        />
      </div>
    </section>
  );
}
