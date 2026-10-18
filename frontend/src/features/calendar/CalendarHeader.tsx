import { ChevronLeft, ChevronRight } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { addMonthsKey, formatMonthTitle } from '@/lib/dates';

import { MAX_MONTH, MIN_MONTH } from './calendarNavigation';

export interface CalendarHeaderProps {
  /** The id given to the month title (it names the grid). */
  titleId: string;
  /** The displayed month, `yyyy-MM`. */
  month: string;
  /** Today's month, `yyyy-MM`. */
  currentMonth: string;
  onMonthChange: (month: string) => void;
}

/**
 * The calendar's title bar: ‹ previous month, the month title (announced when it changes),
 * next month › and a jump back to the current month.
 */
export function CalendarHeader({
  titleId,
  month,
  currentMonth,
  onMonthChange,
}: CalendarHeaderProps) {
  return (
    <div className="flex items-center gap-1 border-b border-line px-2 py-2 sm:gap-2 sm:px-4">
      <IconButton
        label="Previous month"
        size="sm"
        disabled={month <= MIN_MONTH}
        onClick={() => {
          onMonthChange(addMonthsKey(month, -1));
        }}
      >
        <ChevronLeft className="size-5" />
      </IconButton>
      <h2
        id={titleId}
        aria-live="polite"
        className="min-w-0 flex-1 text-center font-heading text-lg break-words text-fg sm:text-xl"
      >
        {formatMonthTitle(month)}
      </h2>
      <IconButton
        label="Next month"
        size="sm"
        disabled={month >= MAX_MONTH}
        onClick={() => {
          onMonthChange(addMonthsKey(month, 1));
        }}
      >
        <ChevronRight className="size-5" />
      </IconButton>
      <Button
        variant="secondary"
        size="sm"
        className="ml-1"
        onClick={() => {
          onMonthChange(currentMonth);
        }}
      >
        Today
      </Button>
    </div>
  );
}
