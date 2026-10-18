/**
 * Deterministic stand-ins for the third-party services the app talks to, served by the network
 * fixture in `fixtures.ts`.
 */

/** One iTunes Search API result (only the fields `src/lib/itunes.ts` reads). */
export interface CatalogSong {
  wrapperType: 'track';
  kind: 'song';
  trackId: number;
  trackName: string;
  artistName: string;
  collectionName: string;
  artworkUrl100: string;
  previewUrl: string;
  trackViewUrl: string;
  trackTimeMillis: number;
}

function song(
  trackId: number,
  trackName: string,
  artistName: string,
  collectionName: string,
  trackTimeMillis: number,
): CatalogSong {
  return {
    wrapperType: 'track',
    kind: 'song',
    trackId,
    trackName,
    artistName,
    collectionName,
    artworkUrl100: `https://is1-ssl.mzstatic.com/image/thumb/Music/v4/${String(trackId)}/100x100bb.jpg`,
    previewUrl: `https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview/${String(trackId)}.m4a`,
    trackViewUrl: `https://music.apple.com/ca/album/${String(trackId)}?i=${String(trackId)}`,
    trackTimeMillis,
  };
}

/** The fake iTunes catalog; search matches every word of the term against title/artist/album. */
export const CATALOG: readonly CatalogSong[] = [
  song(1001, 'Gosh', 'Jamie xx', 'In Colour', 290_000),
  song(1002, 'Loud Places', 'Jamie xx', 'In Colour', 283_000),
  song(1003, 'Midnight City', 'M83', "Hurry Up, We're Dreaming", 244_000),
  song(1004, 'Windowlicker', 'Aphex Twin', 'Windowlicker', 367_000),
  song(1005, 'Teardrop', 'Massive Attack', 'Mezzanine', 330_000),
];

/** A 1×1 transparent PNG, for every artwork request. */
export const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

/** Half a second of 8 kHz, 8-bit mono silence as a valid WAV file, for every preview request. */
export const WAV_SILENCE = ((): Buffer => {
  const sampleRate = 8000;
  const samples = sampleRate / 2;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + samples, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate, 28); // byte rate
  header.writeUInt16LE(1, 32); // block align
  header.writeUInt16LE(8, 34); // bits per sample
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(samples, 40);
  return Buffer.concat([header, Buffer.alloc(samples, 128)]);
})();

/** The youtube-nocookie embed: a trivial page standing in for the real player. */
export const YOUTUBE_EMBED_HTML =
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Video</title></head>' +
  '<body style="margin:0;background:#000"></body></html>';

/** Duration (seconds) every stub video reports once it is ready. */
export const STUB_VIDEO_DURATION_S = 212;

/**
 * A stand-in for `https://www.youtube.com/iframe_api`: defines `window.YT` with the subset of
 * the IFrame API that `src/features/player/**` uses (`Player` with `onReady`, `onStateChange`,
 * `onError`, `onAutoplayBlocked`; `getCurrentTime`, `getDuration`, `seekTo`, `playVideo`,
 * `pauseVideo`, `destroy`; `PlayerState`), then calls `onYouTubeIframeAPIReady`.
 *
 * Like the real player it replaces the mount element with an embed iframe and fires `onReady`
 * once that iframe loads. Tests drive playback (what a viewer does inside the iframe) through
 * `window.__sotdYouTube.players`, e.g. `players.at(-1).playVideo()`.
 */
export const YOUTUBE_IFRAME_API = `(() => {
  'use strict';
  const PlayerState = { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 };
  const DURATION = ${String(STUB_VIDEO_DURATION_S)};
  const registry = { players: [] };

  class Player {
    constructor(element, options) {
      this.options = options;
      this.state = PlayerState.UNSTARTED;
      this.ready = false;
      this.position = 0;
      this.startedAt = 0;
      const iframe = document.createElement('iframe');
      const host = options.host || 'https://www.youtube.com';
      const vars = new URLSearchParams({ enablejsapi: '1', ...(options.playerVars || {}) });
      iframe.src = host + '/embed/' + encodeURIComponent(options.videoId) + '?' + vars;
      iframe.title = 'YouTube video player';
      iframe.width = String(options.width || 640);
      iframe.height = String(options.height || 360);
      iframe.allow = 'autoplay; encrypted-media; picture-in-picture';
      iframe.addEventListener('load', () => {
        if (this.iframe === null) return;
        this.ready = true;
        this.emit('onReady');
      }, { once: true });
      this.iframe = iframe;
      element.replaceWith(iframe);
      registry.players.push(this);
    }

    emit(name, data) {
      const handler = this.options.events && this.options.events[name];
      if (typeof handler === 'function') handler({ target: this, data });
    }

    setState(state) {
      this.state = state;
      this.emit('onStateChange', state);
    }

    getDuration() {
      return this.ready ? DURATION : 0;
    }

    getCurrentTime() {
      if (this.state !== PlayerState.PLAYING) return this.position;
      return Math.min(DURATION, this.position + (performance.now() - this.startedAt) / 1000);
    }

    seekTo(seconds) {
      this.position = Math.max(0, Math.min(DURATION, Number(seconds) || 0));
      this.startedAt = performance.now();
      if (this.state === PlayerState.UNSTARTED) {
        // A seek starts playback; the stub behaves like a browser that blocks that autoplay.
        this.emit('onAutoplayBlocked');
      }
    }

    playVideo() {
      this.startedAt = performance.now();
      this.setState(PlayerState.PLAYING);
    }

    pauseVideo() {
      this.position = this.getCurrentTime();
      this.setState(PlayerState.PAUSED);
    }

    destroy() {
      if (this.iframe !== null) this.iframe.remove();
      this.iframe = null;
      registry.players = registry.players.filter((player) => player !== this);
    }
  }

  window.__sotdYouTube = registry;
  window.YT = { loaded: 1, Player, PlayerState };
  if (typeof window.onYouTubeIframeAPIReady === 'function') window.onYouTubeIframeAPIReady();
})();
`;
