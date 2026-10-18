/**
 * "Find it on YouTube": asks the server's auto-matcher for a song's video and shows the
 * suggestion for confirmation. Confirming hands the video id back — the
 * caller fills its YouTube link field, which is saved with the rest of the form.
 */
import { useMemo, useState } from 'react';

import { useYouTubeMatch } from '@/api/hooks/songs';
import { describeApiError } from '@/api/messages';
import { FormError } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';

import { matchTrack, type MatchableSong } from './matchTrack';
import { YouTubeMatchNote } from './YouTubeMatchNote';

export const FIND_YOUTUBE_MATCH_LABEL = 'Find it on YouTube';
export const USE_VIDEO_LABEL = 'Use this video';
export const REJECT_VIDEO_LABEL = 'Not this one';
export const NO_YOUTUBE_MATCH_MESSAGE =
  "Didn't find a confident match. Search YouTube or paste a link instead.";

export interface YouTubeMatchFinderProps {
  /** The song to look up. */
  song: MatchableSong;
  /** Fills the YouTube link field with the confirmed video id. */
  onUse: (videoId: string) => void;
}

/**
 * Offers the auto-match on demand: the lookup runs when the user asks for it, and the found
 * video is only used when they confirm it.
 */
export function YouTubeMatchFinder({ song, onUse }: YouTubeMatchFinderProps) {
  /** The lookup starts on the first click; from then on the query stays on (and can refetch). */
  const [looking, setLooking] = useState(false);
  const [rejected, setRejected] = useState(false);
  const track = useMemo(() => (looking ? matchTrack(song) : null), [looking, song]);
  const match = useYouTubeMatch(track);
  const suggestion = match.data?.match ?? null;
  const shown = rejected ? null : suggestion;

  function find() {
    setRejected(false);
    if (looking) {
      void match.refetch();
    } else {
      setLooking(true);
    }
  }

  const findButton = (
    <Button
      variant="secondary"
      loading={match.isFetching}
      onClick={() => {
        find();
      }}
    >
      {FIND_YOUTUBE_MATCH_LABEL}
    </Button>
  );

  return (
    <div className="flex flex-col gap-2">
      <FormError message={match.isError ? describeApiError(match.error) : null} />
      {shown !== null ? (
        <YouTubeMatchNote match={shown}>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setRejected(true);
              onUse(shown.video_id);
            }}
          >
            {USE_VIDEO_LABEL}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setRejected(true);
            }}
          >
            {REJECT_VIDEO_LABEL}
          </Button>
        </YouTubeMatchNote>
      ) : looking && match.isSuccess && suggestion === null ? (
        <p role="status" className="text-sm text-muted">
          {NO_YOUTUBE_MATCH_MESSAGE}
        </p>
      ) : (
        findButton
      )}
    </div>
  );
}
