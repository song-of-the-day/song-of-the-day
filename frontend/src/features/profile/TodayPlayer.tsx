import { useTodayEntry } from '@/api/hooks/users';
import type { Entry, IsoDate } from '@/api/types';
import { Artwork } from '@/components/entry';
import { PlayerArea } from '@/features/player/PlayerArea';
import { choosePlayer } from '@/features/player/sources';
import { useYouTubePlayer } from '@/features/player/useYouTubePlayer';

export interface TodayPlayerProps {
  /** The normalized username of the profile being viewed. */
  username: string;
  /** The viewer's local date, `yyyy-MM-dd` (see `useToday`). */
  today: IsoDate;
  /** Try to start playback on load — the viewer's auto-play preference. */
  autoPlay: boolean;
}

/**
 * The profile's "today's song" strip: when the page loads and today has a
 * song with a licensed player — a YouTube video or an Apple preview — it shows the song and its
 * player and tries to start it. It renders nothing when today has no song, or its song has nothing
 * playable (so there is never an empty player). Browsers may block autoplay on load; a blocked
 * player just stays paused.
 */
export function TodayPlayer({ username, today, autoPlay }: TodayPlayerProps) {
  const { data: entry } = useTodayEntry(username, today);
  if (entry === undefined || entry === null || choosePlayer(entry).kind === 'none') {
    return null;
  }
  return <TodayPlayerCard entry={entry} autoPlay={autoPlay} />;
}

interface TodayPlayerCardProps {
  entry: Entry;
  autoPlay: boolean;
}

function TodayPlayerCard({ entry, autoPlay }: TodayPlayerCardProps) {
  const player = useYouTubePlayer(entry.youtube_video_id, { autoPlay });
  return (
    <section aria-label="Today's song" className="y2k-window flex flex-col gap-4 p-4 sm:p-5">
      <div className="flex items-center gap-3">
        <Artwork src={entry.artwork_url} title={entry.title} artist={entry.artist} size="sm" />
        <div className="min-w-0">
          <p className="font-heading text-xs tracking-wide text-muted">
            Today{' '}
            <span aria-hidden="true" className="text-accent">
              ✦
            </span>
          </p>
          <p className="truncate font-body font-semibold text-fg">{entry.title}</p>
          <p className="truncate font-body text-sm text-muted">{entry.artist}</p>
        </div>
      </div>
      <div className="w-full max-w-md">
        <PlayerArea entry={entry} player={player} autoPlay={autoPlay} />
      </div>
    </section>
  );
}
