/**
 * The "Listen on" row: which streaming platforms an entry links to, and where.
 */
import type { Entry } from '@/api/types';

/** The row's slots, in display order; `extra` is the optional generic link at the end. */
export type PlatformKey =
  'spotify' | 'apple' | 'youtube' | 'amazon' | 'tidal' | 'deezer' | 'soundcloud' | 'extra';

export interface ListenOnLink {
  key: PlatformKey;
  /** The pill's visible text: the platform's name, or the hostname for the generic extra link. */
  label: string;
  href: string;
}

/** The entry fields the row is built from. */
export type ListenOnSource = Pick<
  Entry,
  'artist' | 'title' | 'source_id' | 'youtube_video_id' | 'external_url'
>;

interface RowContext {
  /** `encodeURIComponent("<artist> <title>")`, for the search links. */
  query: string;
  sourceId: string | null;
  videoId: string | null;
}

interface Row {
  key: Exclude<PlatformKey, 'extra'>;
  label: string;
  /** Whether the row owns the external link: it then links to it instead of a search. */
  owns: (host: string) => boolean;
  /** The link: the owned external link when there is one, else the platform's search. */
  href: (context: RowContext, ownedUrl: string | null) => string;
}

const BANDCAMP_HOST = /(^|\.)bandcamp\.com$/;

const ROWS: readonly Row[] = [
  {
    key: 'spotify',
    label: 'Spotify',
    owns: (host) => host === 'open.spotify.com',
    href: (context, ownedUrl) => ownedUrl ?? `https://open.spotify.com/search/${context.query}`,
  },
  {
    key: 'apple',
    label: 'Apple Music',
    owns: (host) => host === 'music.apple.com',
    href: (context, ownedUrl) =>
      context.sourceId !== null
        ? `https://music.apple.com/song/${encodeURIComponent(context.sourceId)}`
        : (ownedUrl ?? `https://music.apple.com/search?term=${context.query}`),
  },
  {
    key: 'youtube',
    label: 'YouTube Music',
    owns: (host) => host === 'music.youtube.com',
    href: (context, ownedUrl) =>
      context.videoId !== null
        ? `https://music.youtube.com/watch?v=${encodeURIComponent(context.videoId)}`
        : (ownedUrl ?? `https://music.youtube.com/search?q=${context.query}`),
  },
  {
    key: 'amazon',
    label: 'Amazon Music',
    owns: (host) => host.startsWith('music.amazon.'),
    href: (context, ownedUrl) => ownedUrl ?? `https://music.amazon.com/search/${context.query}`,
  },
  {
    key: 'tidal',
    label: 'Tidal',
    owns: (host) => host === 'tidal.com' || host === 'listen.tidal.com',
    href: (context, ownedUrl) => ownedUrl ?? `https://listen.tidal.com/search?q=${context.query}`,
  },
  {
    key: 'deezer',
    label: 'Deezer',
    owns: (host) =>
      host === 'deezer.com' || host === 'www.deezer.com' || host === 'deezer.page.link',
    href: (context, ownedUrl) => ownedUrl ?? `https://www.deezer.com/search/${context.query}`,
  },
  {
    key: 'soundcloud',
    label: 'SoundCloud',
    owns: (host) =>
      host === 'soundcloud.com' || host === 'm.soundcloud.com' || host === 'on.soundcloud.com',
    href: (context, ownedUrl) =>
      ownedUrl ?? `https://soundcloud.com/search/sounds?q=${context.query}`,
  },
];

/** The lower-cased hostname of an external link, or `null` when it isn't a parsable URL. */
function hostOf(url: string | null): string | null {
  if (url === null) {
    return null;
  }
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** The extra link's label: "Bandcamp" for Bandcamp hosts, else the hostname without `www.`. */
function extraLabel(host: string): string {
  return BANDCAMP_HOST.test(host) ? 'Bandcamp' : host.replace(/^www\./, '');
}

/**
 * Builds an entry's "Listen on" links: one per platform, in order, each one
 * the entry's own external link when that link belongs to the platform, else a platform search.
 * A host no platform owns adds one extra link to it (Bandcamp, or the bare hostname).
 *
 * @param entry - The entry's song fields.
 * @returns The links to render, in order.
 */
export function listenOnLinks(entry: ListenOnSource): ListenOnLink[] {
  const host = hostOf(entry.external_url);
  const context: RowContext = {
    query: encodeURIComponent(`${entry.artist} ${entry.title}`),
    sourceId: entry.source_id,
    videoId: entry.youtube_video_id,
  };
  const links: ListenOnLink[] = ROWS.map((row) => {
    const owned = host !== null && row.owns(host);
    return {
      key: row.key,
      label: row.label,
      href: row.href(context, owned ? entry.external_url : null),
    };
  });
  if (host !== null && entry.external_url !== null && !ROWS.some((row) => row.owns(host))) {
    links.push({ key: 'extra', label: extraLabel(host), href: entry.external_url });
  }
  return links;
}
