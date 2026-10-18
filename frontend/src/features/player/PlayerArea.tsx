import { PreviewPlayer } from './PreviewPlayer';
import { choosePlayer, type PlayerSource } from './sources';
import type { YouTubePlayerController } from './useYouTubePlayer';
import { YouTubePlayer } from './YouTubePlayer';

export interface PlayerAreaProps {
  entry: PlayerSource;
  /** The controller from `useYouTubePlayer(entry.youtube_video_id)`. */
  player: YouTubePlayerController;
  /** Start the Apple preview on mount (YouTube auto-play is the controller's option). */
  autoPlay?: boolean;
}

/**
 * The entry's player: only the YouTube player when a video is attached,
 * otherwise Apple's preview for an iTunes song with one, otherwise nothing.
 */
export function PlayerArea({ entry, player, autoPlay = false }: PlayerAreaProps) {
  const choice = choosePlayer(entry);
  switch (choice.kind) {
    case 'youtube':
      return <YouTubePlayer videoId={choice.videoId} player={player} />;
    case 'preview':
      // A new song gets a fresh control (and a new chance to play).
      return (
        <PreviewPlayer key={choice.previewUrl} previewUrl={choice.previewUrl} autoPlay={autoPlay} />
      );
    case 'none':
      return null;
  }
}
