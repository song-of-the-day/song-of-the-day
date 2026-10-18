import type { ReactNode } from 'react';

import type { YouTubeMatch } from '@/api/types';

export interface YouTubeMatchNoteProps {
  match: YouTubeMatch;
  /** Actions beside the note, e.g. "Use this video" and "Not this one". */
  children?: ReactNode;
}

/**
 * The "✦ Matched on YouTube: <title> · <channel>" line shown with a suggested video.
 * Announced politely, since it appears after a background lookup.
 */
export function YouTubeMatchNote({ match, children }: YouTubeMatchNoteProps) {
  return (
    <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-fg">
      <p className="min-w-0 break-words">
        <span aria-hidden="true" className="text-accent">
          ✦{' '}
        </span>
        Matched on YouTube:{' '}
        <span className="text-muted">
          {match.title} · {match.channel_title}
        </span>
      </p>
      {children}
    </div>
  );
}
