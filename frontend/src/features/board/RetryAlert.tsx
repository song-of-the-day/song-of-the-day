import { describeApiError } from '@/api/messages';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';

export interface RetryAlertProps {
  /** What failed, e.g. "Couldn't load your songs." */
  title: string;
  /** The query's error, described in words the user can act on. */
  error: unknown;
  /** Whether the retry is running. */
  retrying: boolean;
  onRetry: () => void;
  className?: string;
}

/** An error message for a failed load, with a "Try again" button. */
export function RetryAlert({ title, error, retrying, onRetry, className }: RetryAlertProps) {
  return (
    <Alert tone="error" title={title} className={className}>
      <p>{describeApiError(error)}</p>
      <Button variant="secondary" size="sm" className="mt-3" loading={retrying} onClick={onRetry}>
        Try again
      </Button>
    </Alert>
  );
}
