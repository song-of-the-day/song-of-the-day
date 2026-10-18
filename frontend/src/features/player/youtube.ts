/**
 * Loads the YouTube IFrame Player API and types the small part of it the app
 * uses. The script is injected once; every caller shares the same promise.
 */

/** The IFrame API script. Its widget code then embeds players from the host passed to them. */
export const IFRAME_API_SRC = 'https://www.youtube.com/iframe_api';
/** How long to wait for `onYouTubeIframeAPIReady` before giving up. */
export const LOAD_TIMEOUT_MS = 10_000;

/** `YT.PlayerState` values (stable parts of the public API). */
export const PLAYER_STATE = {
  UNSTARTED: -1,
  ENDED: 0,
  PLAYING: 1,
  PAUSED: 2,
  BUFFERING: 3,
  CUED: 5,
} as const;

/** A YouTube player state, as reported by `onStateChange`. */
export type PlayerState = number;

/** The methods of a `YT.Player` the app calls (valid once `onReady` has fired). */
export interface YouTubePlayer {
  /** The playback position in seconds. */
  getCurrentTime(): number;
  /** The video length in seconds; 0 until the metadata has loaded. */
  getDuration(): number;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  /** Starts or resumes playback (the browser may block it: `onAutoplayBlocked`). */
  playVideo(): void;
  pauseVideo(): void;
  /** Removes the iframe and stops playback. */
  destroy(): void;
}

/** The argument of every player event handler. */
export interface YouTubePlayerEvent<Data = undefined> {
  target: YouTubePlayer;
  data: Data;
}

export interface YouTubePlayerEvents {
  onReady?: (event: YouTubePlayerEvent) => void;
  /** `data` is a {@link PLAYER_STATE} value. */
  onStateChange?: (event: YouTubePlayerEvent<PlayerState>) => void;
  /** `data` is an error code: 2, 5, 100, 101 or 150. */
  onError?: (event: YouTubePlayerEvent<number>) => void;
  /** The browser blocked playback that a script (e.g. a seek) tried to start. */
  onAutoplayBlocked?: (event: YouTubePlayerEvent) => void;
}

export interface YouTubePlayerOptions {
  /** The embed origin, e.g. `https://www.youtube-nocookie.com`. */
  host?: string;
  videoId: string;
  width?: number | string;
  height?: number | string;
  playerVars?: Record<string, number | string>;
  events?: YouTubePlayerEvents;
}

/** The global `YT` namespace the IFrame API defines. */
export interface YouTubeIframeApi {
  /** 1 once the API is fully loaded. */
  loaded?: number;
  Player: new (element: HTMLElement, options: YouTubePlayerOptions) => YouTubePlayer;
}

declare global {
  interface Window {
    YT?: YouTubeIframeApi;
    onYouTubeIframeAPIReady?: () => void;
  }
}

/** The IFrame API script failed to load or did not become ready in time. */
export class YouTubeLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'YouTubeLoadError';
  }
}

let pending: Promise<YouTubeIframeApi> | null = null;

function loadedApi(): YouTubeIframeApi | null {
  const api = window.YT;
  return api?.loaded === 1 && typeof api.Player === 'function' ? api : null;
}

function injectScript(): Promise<YouTubeIframeApi> {
  return new Promise<YouTubeIframeApi>((resolve, reject) => {
    const script = document.createElement('script');
    let settled = false;

    const settle = (outcome: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      window.clearTimeout(timer);
      outcome();
    };

    const fail = (message: string): void => {
      settle(() => {
        script.remove();
        reject(new YouTubeLoadError(message));
      });
    };

    const timer = window.setTimeout(() => {
      fail('The YouTube player API did not load in time.');
    }, LOAD_TIMEOUT_MS);

    // Another script on the page may rely on this global callback too, so keep calling it.
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      const api = window.YT;
      if (api === undefined) {
        fail('The YouTube player API reported ready without defining YT.');
      } else {
        settle(() => {
          resolve(api);
        });
      }
      previous?.();
    };

    script.src = IFRAME_API_SRC;
    script.async = true;
    script.addEventListener('error', () => {
      fail('The YouTube player API could not be loaded.');
    });
    document.head.append(script);
  });
}

/**
 * Loads the YouTube IFrame Player API once.
 *
 * The script is injected on the first call. The promise resolves when YouTube calls
 * `onYouTubeIframeAPIReady` (any handler that was already installed still runs). It rejects when
 * the script fails to load or after {@link LOAD_TIMEOUT_MS}; the cached promise is then dropped,
 * so a later call injects the script again.
 *
 * @returns The global `YT` namespace.
 * @throws YouTubeLoadError (as a rejection) when the API can't be loaded.
 */
export function loadYouTubeIframeApi(): Promise<YouTubeIframeApi> {
  const api = loadedApi();
  if (api !== null) {
    return Promise.resolve(api);
  }
  if (pending === null) {
    const attempt = injectScript();
    pending = attempt;
    attempt.catch(() => {
      if (pending === attempt) {
        pending = null;
      }
    });
  }
  return pending;
}
