import { CircleAlert } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { watchUrl } from '@/lib/youtube';

import { ExternalLink } from './ExternalLink';
import type { YouTubePlayerController } from './useYouTubePlayer';

export const UNPLAYABLE_MESSAGE = "This video can't be played here";
export const LOAD_FAILED_MESSAGE = "The YouTube player couldn't load.";
export const AUTOPLAY_BLOCKED_MESSAGE = 'Press play on the video';

export interface YouTubePlayerProps {
  videoId: string;
  /** The controller from `useYouTubePlayer(videoId)`. */
  player: YouTubePlayerController;
}

/**
 * The embedded YouTube player: always visible, full width, 16:9 and at least 200×200 px (YouTube's
 * required minimum). Shows a spinner until the player is ready, a fallback link when the video
 * can't be played, and a hint when the browser blocks playback.
 */
export function YouTubePlayer({ videoId, player }: YouTubePlayerProps) {
  const { setHost, ready, error, autoplayBlocked, retry } = player;
  return (
    <div>
      <div className="relative aspect-video min-h-[200px] w-full min-w-[200px] overflow-hidden border border-line bg-fg/5">
        <div ref={setHost} className="absolute inset-0 [&>iframe]:size-full" />
        {error === null && !ready && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Spinner size="lg" label="Loading the video…" />
          </div>
        )}
        {error !== null && (
          <div
            role="alert"
            className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-surface p-4 text-center text-sm text-fg"
          >
            <CircleAlert aria-hidden="true" className="size-6 text-accent" />
            <p className="font-semibold">
              {error === 'unplayable' ? UNPLAYABLE_MESSAGE : LOAD_FAILED_MESSAGE}
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3">
              {error === 'load_failed' && (
                <Button variant="secondary" size="sm" onClick={retry}>
                  Try again
                </Button>
              )}
              <ExternalLink href={watchUrl(videoId)}>Watch on YouTube</ExternalLink>
            </div>
          </div>
        )}
      </div>
      {/* Always rendered, so screen readers announce the hint when it appears. */}
      <p role="status" className="text-sm font-medium text-fg not-empty:mt-2">
        {autoplayBlocked && error === null ? AUTOPLAY_BLOCKED_MESSAGE : null}
      </p>
    </div>
  );
}
