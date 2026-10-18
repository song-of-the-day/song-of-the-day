import { useId } from 'react';

import { useProfileBoardEntries } from '@/api/hooks/users';
import { describeApiError } from '@/api/messages';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import type { CardStyle } from '@/lib/theme';

import { EntryCard } from './EntryCard';
import { RetryAlert } from './RetryAlert';
import { useWhenVisible } from './useWhenVisible';

export interface BoardViewProps {
  /** The profile's (normalized) username. */
  username: string;
  /** Visitor mode: no "Log today's song" in the empty state, and copy about "these" songs. */
  readOnly: boolean;
  /** The theme's card style. */
  cardStyle: CardStyle;
  /** Opens an entry's dialog. */
  onOpenEntry: (entryId: number) => void;
  /** Opens the log dialog for today (from the empty state). */
  onLogToday: () => void;
}

/** The board grid: row-major, newest first. */
const GRID = 'grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-3 sm:gap-4';
const SKELETON_CARDS = 8;

function BoardSkeleton({ readOnly }: { readOnly: boolean }) {
  return (
    <div role="status">
      <span className="sr-only">{readOnly ? 'Loading songs…' : 'Loading your songs…'}</span>
      <div aria-hidden="true" className={GRID}>
        {Array.from({ length: SKELETON_CARDS }, (_, index) => (
          <div key={index} className="y2k-window p-2 motion-safe:animate-pulse">
            <div className="aspect-square bg-line/40" />
            <div className="mt-2 h-3.5 w-3/4 rounded-sm bg-line/40" />
            <div className="mt-1.5 h-3.5 w-1/2 rounded-sm bg-line/40" />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * The Board view: every entry as a card, newest first, loading older pages as the end of the
 * grid scrolls into view (with a "Load more" button as the fallback). Shows skeleton cards while
 * loading, a retryable error, or an empty state that invites logging today's song.
 */
export function BoardView({
  username,
  readOnly,
  cardStyle,
  onOpenEntry,
  onLogToday,
}: BoardViewProps) {
  const headingId = useId();
  const board = useProfileBoardEntries(username);
  const { fetchNextPage } = board;
  const canAutoLoad = board.hasNextPage && !board.isFetchingNextPage && !board.isFetchNextPageError;
  const sentinelRef = useWhenVisible<HTMLDivElement>(() => {
    void fetchNextPage();
  }, canAutoLoad);

  if (board.isPending) {
    return <BoardSkeleton readOnly={readOnly} />;
  }
  if (board.data === undefined) {
    return (
      <RetryAlert
        title={readOnly ? "Couldn't load these songs." : "Couldn't load your songs."}
        error={board.error}
        retrying={board.isFetching}
        className="mx-auto w-full max-w-md"
        onRetry={() => {
          void board.refetch();
        }}
      />
    );
  }
  if (board.data.length === 0) {
    return (
      <EmptyState
        title={
          <>
            no songs yet <span aria-hidden="true">✦</span>
          </>
        }
        action={
          readOnly ? undefined : (
            <Button icon={<span aria-hidden="true">✦</span>} onClick={onLogToday}>
              Log today&apos;s song
            </Button>
          )
        }
      />
    );
  }

  return (
    <div>
      <h2 id={headingId} className="sr-only">
        {readOnly ? 'Songs' : 'Your songs'}
      </h2>
      <ul aria-labelledby={headingId} className={GRID}>
        {board.data.map((entry) => (
          <li key={entry.id}>
            <EntryCard entry={entry} cardStyle={cardStyle} onOpen={onOpenEntry} />
          </li>
        ))}
      </ul>
      {board.hasNextPage && (
        <div className="mt-6 flex flex-col items-center gap-3">
          <div ref={sentinelRef} data-board-sentinel="" aria-hidden="true" />
          {board.isFetchNextPageError && (
            <Alert tone="error" title="Couldn't load older songs." className="w-full max-w-md">
              {describeApiError(board.error)}
            </Alert>
          )}
          <Button
            variant="secondary"
            loading={board.isFetchingNextPage}
            onClick={() => {
              void fetchNextPage();
            }}
          >
            {board.isFetchNextPageError ? 'Try again' : 'Load more'}
          </Button>
        </div>
      )}
    </div>
  );
}
