import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

export interface EmptyStateProps {
  /** A short heading in the heading font, e.g. "no songs yet ✦". */
  title: ReactNode;
  description?: ReactNode;
  /** A call to action, e.g. a "Log today's song" button. */
  action?: ReactNode;
  /** The heading level (default 2). */
  headingLevel?: 2 | 3;
  className?: string;
}

/**
 * A centered surface window for "nothing here yet" states (text never sits on the page
 * background).
 */
export function EmptyState({
  title,
  description,
  action,
  headingLevel = 2,
  className,
}: EmptyStateProps) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <div
      className={cn(
        'y2k-window mx-auto flex w-full max-w-md flex-col items-center gap-3 px-6 py-10 text-center',
        className,
      )}
    >
      <span aria-hidden="true" className="font-heading text-2xl text-accent">
        ✧
      </span>
      <Heading className="font-heading text-lg text-fg">{title}</Heading>
      {description !== undefined && <p className="text-sm text-muted">{description}</p>}
      {action !== undefined && <div className="mt-2">{action}</div>}
    </div>
  );
}
