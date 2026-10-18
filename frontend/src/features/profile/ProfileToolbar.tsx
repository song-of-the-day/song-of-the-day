import { CalendarDays, LayoutGrid, Plus } from 'lucide-react';

import { useTodayEntry } from '@/api/hooks/users';
import { Artwork } from '@/components/entry';
import { Button } from '@/components/ui/Button';
import { SegmentedControl, type SegmentedOption } from '@/components/ui/SegmentedControl';
import type { DefaultView } from '@/lib/theme';

export interface ProfileToolbarProps {
  /** The profile's (normalized) username. */
  username: string;
  /** Visitor mode: only the Board | Calendar switch. */
  readOnly: boolean;
  /** Today's date, `yyyy-MM-dd`. */
  today: string;
  view: DefaultView;
  onViewChange: (view: DefaultView) => void;
  /** Opens the log dialog for today (its date field defaults to today). */
  onLogToday: () => void;
  /** Opens the log dialog without a date; the user must pick one. */
  onLogDay: () => void;
  onOpenEntry: (entryId: number) => void;
}

const VIEW_OPTIONS: readonly SegmentedOption<DefaultView>[] = [
  { value: 'board', label: 'Board', icon: <LayoutGrid aria-hidden="true" className="size-4" /> },
  {
    value: 'calendar',
    label: 'Calendar',
    icon: <CalendarDays aria-hidden="true" className="size-4" />,
  },
];

const SPARKLE = <span aria-hidden="true">✦</span>;

function TodayAction({
  username,
  today,
  onLogToday,
  onOpenEntry,
}: Pick<ProfileToolbarProps, 'username' | 'today' | 'onLogToday' | 'onOpenEntry'>) {
  const todayEntry = useTodayEntry(username, today);
  const entry = todayEntry.data;

  if (entry === undefined || entry === null) {
    return (
      <Button icon={SPARKLE} loading={todayEntry.isPending} onClick={onLogToday}>
        Log today&apos;s song
      </Button>
    );
  }
  return (
    <Button
      variant="secondary"
      className="max-w-full min-w-0"
      icon={
        <span aria-hidden="true" className="block size-6 shrink-0">
          <Artwork src={entry.artwork_url} title={entry.title} artist={entry.artist} size="fill" />
        </span>
      }
      onClick={() => {
        onOpenEntry(entry.id);
      }}
    >
      <span className="truncate">
        Today: {entry.title} — {entry.artist}
      </span>
    </Button>
  );
}

/**
 * The profile's toolbar panel: for the owner, today's call to action (log today's song, or open
 * it once logged) and "Log a day" for past days; for everyone, the Board | Calendar switch.
 */
export function ProfileToolbar({
  username,
  readOnly,
  today,
  view,
  onViewChange,
  onLogToday,
  onLogDay,
  onOpenEntry,
}: ProfileToolbarProps) {
  return (
    <div className="y2k-window flex flex-wrap items-center gap-2 p-2 sm:p-3">
      {!readOnly && (
        <>
          <TodayAction
            username={username}
            today={today}
            onLogToday={onLogToday}
            onOpenEntry={onOpenEntry}
          />
          <Button
            variant="secondary"
            icon={<Plus aria-hidden="true" className="size-4" />}
            onClick={onLogDay}
          >
            Log a day
          </Button>
        </>
      )}
      <SegmentedControl
        label="View"
        options={VIEW_OPTIONS}
        value={view}
        onChange={onViewChange}
        className="sm:ml-auto"
      />
    </div>
  );
}
