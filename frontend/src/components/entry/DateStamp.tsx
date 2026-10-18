import { format } from 'date-fns';

import { useToday } from '@/hooks/useToday';
import { cn } from '@/lib/cn';
import { formatFullDate, parseIsoDate } from '@/lib/dates';

export interface DateStampProps {
  /** The calendar date, `yyyy-MM-dd`. */
  date: string;
  className?: string;
}

/**
 * A heading-font "sticker" date stamp such as `OCT 11`, with the year added for other years
 * (`MAR 3 2025`). The stamp is visual only; assistive technology reads the full date
 * ("Sunday, October 11, 2026"), which is also the tooltip. A malformed date is shown as given.
 */
export function DateStamp({ date, className }: DateStampProps) {
  const today = useToday();
  const day = parseIsoDate(date);
  const classes = cn('y2k-stamp whitespace-nowrap tabular-nums', className);

  if (day === null) {
    return <time className={classes}>{date}</time>;
  }

  const sameYear = date.slice(0, 4) === today.slice(0, 4);
  const stamp = format(day, sameYear ? 'MMM d' : 'MMM d yyyy').toUpperCase();
  const fullDate = formatFullDate(date);

  return (
    <time dateTime={date} title={fullDate} className={classes}>
      <span aria-hidden="true">{stamp}</span>
      <span className="sr-only">{fullDate}</span>
    </time>
  );
}
