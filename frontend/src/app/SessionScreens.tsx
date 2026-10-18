import { Button } from '@/components/ui/Button';
import { CenteredPage } from '@/components/ui/CenteredPage';
import { DocumentTitle } from '@/components/ui/DocumentTitle';
import { Spinner } from '@/components/ui/Spinner';
import { Window } from '@/components/ui/Window';

/** Shown while the session (`/api/auth/me`) is loading. */
export function SessionLoading() {
  return (
    <CenteredPage>
      <Spinner size="lg" label="Loading your journal…" />
    </CenteredPage>
  );
}

export interface SessionErrorProps {
  /** Loads the session again. */
  onRetry: () => void;
  /** A retry is running. */
  retrying: boolean;
}

/**
 * Shown when the session couldn't be loaded (network or server failure, not "logged out"), so
 * the user isn't sent to a login form that would fail the same way.
 */
export function SessionError({ onRetry, retrying }: SessionErrorProps) {
  return (
    <CenteredPage>
      <DocumentTitle title="Can't connect" />
      <Window
        title="can't connect ✦"
        headingLevel={1}
        className="w-full max-w-sm"
        bodyClassName="flex flex-col gap-4 p-6"
      >
        <p className="text-sm text-fg">
          We couldn&apos;t reach song of the day. Check your connection and try again.
        </p>
        <Button onClick={onRetry} loading={retrying} className="self-start">
          Try again
        </Button>
      </Window>
    </CenteredPage>
  );
}
