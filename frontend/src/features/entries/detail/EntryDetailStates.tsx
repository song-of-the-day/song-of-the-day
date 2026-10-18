import { describeApiError } from '@/api/messages';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';

import { DETAIL_GRID_CLASS_NAME } from './layout';

export const NOT_FOUND_MESSAGE = "This entry doesn't exist anymore";
export const LOAD_ERROR_MESSAGE = "Couldn't load this song.";

const BLOCK = 'bg-line/40 motion-safe:animate-pulse';

/** Placeholder shapes in the dialog's layout while the entry loads. */
export function EntryDetailSkeleton() {
  return (
    <div className={DETAIL_GRID_CLASS_NAME}>
      <span role="status" className="sr-only">
        Loading song…
      </span>
      <div aria-hidden="true" className="flex items-start gap-4 md:flex-col">
        <div className={cn('aspect-square w-28 shrink-0 sm:w-36 md:w-full', BLOCK)} />
        <div className="flex w-full flex-col gap-2">
          <div className={cn('h-6 w-3/4 rounded-sm', BLOCK)} />
          <div className={cn('h-4 w-1/2 rounded-sm', BLOCK)} />
          <div className={cn('h-4 w-1/3 rounded-sm', BLOCK)} />
        </div>
      </div>
      <div aria-hidden="true" className="flex flex-col gap-4">
        <div className={cn('h-4 w-full rounded-sm', BLOCK)} />
        <div className={cn('h-4 w-2/3 rounded-sm', BLOCK)} />
        <div className={cn('aspect-video w-full', BLOCK)} />
      </div>
    </div>
  );
}

/** The entry was deleted (or never existed); the dialog's footer offers Close. */
export function EntryNotFound() {
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-center">
      <span aria-hidden="true" className="font-heading text-2xl text-accent">
        ✧
      </span>
      <p className="text-base text-fg">{NOT_FOUND_MESSAGE}</p>
    </div>
  );
}

export interface EntryLoadErrorProps {
  error: unknown;
  retrying: boolean;
  onRetry: () => void;
}

/** Loading the entry failed for another reason (network, server); offers a retry. */
export function EntryLoadError({ error, retrying, onRetry }: EntryLoadErrorProps) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 py-10 text-center">
      <p className="text-base font-semibold text-fg">{LOAD_ERROR_MESSAGE}</p>
      <p className="text-sm text-muted">{describeApiError(error)}</p>
      <Button variant="secondary" loading={retrying} onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}
