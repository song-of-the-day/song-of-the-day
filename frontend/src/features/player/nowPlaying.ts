/**
 * The app-wide "now playing" controller: at most one preview or player plays
 * at a time. A player claims playback when it starts; the previous one is paused.
 */

/** Anything that can be told to stop playing. */
export interface Playable {
  pause: () => void;
}

let current: Playable | null = null;

/**
 * Records that `playable` started playing, pausing whatever played before.
 *
 * @param playable - The player that started.
 */
export function claimPlayback(playable: Playable): void {
  if (current !== null && current !== playable) {
    current.pause();
  }
  current = playable;
}

/**
 * Forgets `playable` (when it pauses, ends or unmounts) if it is the one playing.
 *
 * @param playable - The player that stopped.
 */
export function releasePlayback(playable: Playable): void {
  if (current === playable) {
    current = null;
  }
}

/**
 * The player currently playing, if any (for tests and diagnostics).
 *
 * @returns The playing player, or `null`.
 */
export function nowPlaying(): Playable | null {
  return current;
}
