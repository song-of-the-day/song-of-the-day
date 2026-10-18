import { Pause, Play } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { IconButton } from '@/components/ui/IconButton';
import { formatMs } from '@/lib/time';

import { claimPlayback, releasePlayback, type Playable } from './nowPlaying';

export interface PreviewPlayerProps {
  /** Apple's 30-second preview, streamed straight from its CDN. */
  previewUrl: string;
  /** Start playing on mount (the viewer's auto-play preference). Blocked playback is silent. */
  autoPlay?: boolean;
}

/**
 * Starts the audio. A rejected play() (autoplay policy, unsupported source) leaves it paused and
 * is deliberately silent: the control just shows "Play".
 */
function play(audio: HTMLAudioElement): void {
  audio.play().catch(() => undefined);
}

/**
 * A compact play/pause control with a progress display for Apple's 30-second preview.
 * The audio loads only when played (or on mount with `autoPlay`).
 * Starting it pauses any other player (see `nowPlaying`), and unmounting stops it. If it can't be
 * played, the control disappears.
 */
export function PreviewPlayer({ previewUrl, autoPlay = false }: PreviewPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  // One stable handle per mounted control, for the shared now-playing controller.
  const [playable] = useState<Playable>(() => ({
    pause: () => {
      audioRef.current?.pause();
    },
  }));

  function readProgress() {
    const audio = audioRef.current;
    if (audio === null) {
      return;
    }
    setElapsedMs(Number.isFinite(audio.currentTime) ? Math.round(audio.currentTime * 1000) : 0);
    setDurationMs(Number.isFinite(audio.duration) ? Math.round(audio.duration * 1000) : 0);
  }

  // Auto-play only once, when the control mounts (a new song gets a new control).
  const [autoPlayOnMount] = useState(autoPlay);
  useEffect(() => {
    const audio = audioRef.current;
    if (autoPlayOnMount && audio !== null) {
      play(audio);
    }
    return () => {
      // A detached <audio> keeps playing, so stop it explicitly.
      audio?.pause();
      releasePlayback(playable);
    };
  }, [autoPlayOnMount, playable]);

  function toggle() {
    const audio = audioRef.current;
    if (audio === null) {
      return;
    }
    if (audio.paused) {
      play(audio);
    } else {
      audio.pause();
    }
  }

  const complete = durationMs > 0 && elapsedMs >= durationMs;
  const progress = durationMs > 0 ? Math.min(100, (elapsedMs / durationMs) * 100) : 0;

  return (
    <div className="flex w-full max-w-xs items-center gap-3">
      {/* A music preview has no spoken words to caption. */}
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio
        ref={audioRef}
        src={previewUrl}
        preload="none"
        onPlay={() => {
          claimPlayback(playable);
          setPlaying(true);
        }}
        onPause={() => {
          releasePlayback(playable);
          setPlaying(false);
        }}
        onEnded={() => {
          releasePlayback(playable);
          setPlaying(false);
        }}
        onTimeUpdate={readProgress}
        onDurationChange={readProgress}
        onError={() => {
          releasePlayback(playable);
          setPlaying(false);
          setFailed(true);
        }}
      />
      {!failed && (
        <>
          <IconButton
            label={playing ? 'Pause preview' : 'Play preview'}
            variant="primary"
            size="sm"
            onClick={toggle}
          >
            {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
          </IconButton>
          <div
            role="progressbar"
            aria-label="Preview progress"
            aria-valuemin={0}
            aria-valuemax={Math.round(durationMs / 1000)}
            aria-valuenow={complete ? Math.round(durationMs / 1000) : Math.round(elapsedMs / 1000)}
            aria-valuetext={`${formatMs(elapsedMs)} of ${formatMs(durationMs)}`}
            className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full border border-muted"
          >
            <div className="h-full bg-accent" style={{ width: `${String(progress)}%` }} />
          </div>
          <span className="text-xs text-muted tabular-nums">{formatMs(elapsedMs)}</span>
        </>
      )}
    </div>
  );
}
