import type { RefCallback } from 'react';

import { Artwork } from '@/components/entry';
import { Button } from '@/components/ui/Button';
import { PreviewPlayer } from '@/features/player/PreviewPlayer';
import { choosePlayer } from '@/features/player/sources';
import { formatMs } from '@/lib/time';

import { songByline, type SongDraft } from './songDraft';

export interface SongSummaryProps {
  song: SongDraft;
  /** Start the preview when it appears. */
  autoPlayPreview: boolean;
  /**
   * Whether to show the song's preview control. Edit mode shows it only for a newly chosen song;
   * the saved song plays in the player area instead.
   */
  showPreview?: boolean;
  onChangeSong: () => void;
  /** Receives the summary, which takes focus when the details step opens. */
  summaryRef: RefCallback<HTMLElement>;
}

/**
 * The chosen song at the top of the details step, with "Change song". An
 * iTunes song with a preview gets the preview control; each song gets a fresh control, and
 * leaving the step or closing the dialog stops it.
 */
export function SongSummary({
  song,
  autoPlayPreview,
  showPreview = true,
  onChangeSong,
  summaryRef,
}: SongSummaryProps) {
  const player = choosePlayer({ ...song, youtube_video_id: null });
  return (
    <div
      ref={summaryRef}
      role="group"
      aria-label="Chosen song"
      tabIndex={-1}
      className="flex flex-col gap-3 rounded-md border border-line p-3"
    >
      <div className="flex items-center gap-3">
        <Artwork src={song.artwork_url} title={song.title} artist={song.artist} />
        <div className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
          <p className="font-semibold break-words text-fg">{song.title}</p>
          <p className="text-sm break-words text-muted">{songByline(song)}</p>
          {song.duration_ms !== null && (
            <p className="text-sm text-muted tabular-nums">{formatMs(song.duration_ms)}</p>
          )}
          <Button variant="secondary" size="sm" className="mt-1.5" onClick={onChangeSong}>
            Change song
          </Button>
        </div>
      </div>
      {showPreview && player.kind === 'preview' && (
        <PreviewPlayer
          key={player.previewUrl}
          previewUrl={player.previewUrl}
          autoPlay={autoPlayPreview}
        />
      )}
    </div>
  );
}
