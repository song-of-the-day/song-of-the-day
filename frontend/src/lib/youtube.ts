/**
 * YouTube link parsing and URL builders.
 */

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const WATCH_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
]);
const SHORT_HOSTS = new Set(['youtu.be']);
const NOCOOKIE_HOSTS = new Set(['youtube-nocookie.com', 'www.youtube-nocookie.com']);

function toUrl(input: string): URL | null {
  const withScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(input) ? input : `https://${input}`;
  try {
    const url = new URL(withScheme);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url : null;
  } catch {
    return null;
  }
}

function idFromPath(pathname: string, prefix: string): string | null {
  if (!pathname.startsWith(prefix)) {
    return null;
  }
  const [id = ''] = pathname.slice(prefix.length).split('/');
  return id;
}

function candidateId(url: URL): string | null {
  const host = url.hostname.toLowerCase();
  if (SHORT_HOSTS.has(host)) {
    return idFromPath(url.pathname, '/');
  }
  if (NOCOOKIE_HOSTS.has(host)) {
    return idFromPath(url.pathname, '/embed/');
  }
  if (!WATCH_HOSTS.has(host)) {
    return null;
  }
  if (url.pathname === '/watch') {
    return url.searchParams.get('v');
  }
  return idFromPath(url.pathname, '/shorts/') ?? idFromPath(url.pathname, '/embed/');
}

/**
 * Extracts the video id from a YouTube link or a bare 11-character id.
 *
 * Accepts `youtube.com/watch?v=`, `m.youtube.com`, `music.youtube.com/watch?v=`, `youtu.be/<id>`,
 * `youtube.com/shorts/<id>`, `youtube.com/embed/<id>` and `youtube-nocookie.com/embed/<id>`,
 * with or without a scheme. Other query parameters (`t`, `list`, `si`, …) are ignored.
 *
 * @param input - What the user pasted.
 * @returns The 11-character video id, or `null` when none is found.
 */
export function parseYouTubeId(input: string): string | null {
  const value = input.trim();
  if (VIDEO_ID.test(value)) {
    return value;
  }
  const url = toUrl(value);
  const id = url === null ? null : candidateId(url);
  return id !== null && VIDEO_ID.test(id) ? id : null;
}

/**
 * Builds the YouTube watch page URL for a video.
 *
 * @param videoId - The 11-character video id.
 * @returns `https://www.youtube.com/watch?v=<id>`.
 */
export function watchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
}

/**
 * Builds a YouTube search URL for a song ("Find on YouTube").
 *
 * @param artist - The song's artist.
 * @param title - The song's title.
 * @returns The results page URL for `"<artist> <title>"`.
 */
export function searchUrl(artist: string, title: string): string {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(`${artist} ${title}`)}`;
}
