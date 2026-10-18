import { Link as LinkIcon, Music } from 'lucide-react';
import {
  siApplemusic,
  siBandcamp,
  siDeezer,
  siSoundcloud,
  siSpotify,
  siTidal,
  siYoutubemusic,
} from 'simple-icons';

import { VisuallyHidden } from '@/components/ui/VisuallyHidden';
import { ExternalLink } from '@/features/player/ExternalLink';
import { listenOnLinks, type ListenOnSource, type PlatformKey } from '@/lib/platforms';

/** The brand marks that exist in the installed `simple-icons` version (paths are CC0). */
const BRAND_PATHS: Partial<Record<PlatformKey, string>> = {
  spotify: siSpotify.path,
  apple: siApplemusic.path,
  youtube: siYoutubemusic.path,
  tidal: siTidal.path,
  deezer: siDeezer.path,
  soundcloud: siSoundcloud.path,
};

const ICON_CLASS = 'size-3.5 shrink-0';

/**
 * A platform's mark: its `simple-icons` path rendered monochrome in the current color, lucide's
 * `Music` for a platform the icon set doesn't ship (Amazon Music), and lucide's `Link` for the
 * generic extra link.
 */
function PlatformIcon({ platform, label }: { platform: PlatformKey; label: string }) {
  const path =
    platform === 'extra'
      ? label === 'Bandcamp'
        ? siBandcamp.path
        : undefined
      : BRAND_PATHS[platform];
  if (path === undefined) {
    return platform === 'extra' ? (
      <LinkIcon aria-hidden="true" className={ICON_CLASS} />
    ) : (
      <Music aria-hidden="true" className={ICON_CLASS} />
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={ICON_CLASS}>
      <path d={path} />
    </svg>
  );
}

const PILL_CLASS =
  'inline-flex items-center gap-1.5 rounded-full border border-muted bg-surface px-2.5 py-1 text-xs text-fg hover:bg-fg/5 active:bg-fg/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

export interface ListenOnRowProps {
  /** The entry's song fields (see `listenOnLinks`). */
  entry: ListenOnSource;
}

/**
 * The "Listen on" row shown in the entry dialog's view mode: a visible label
 * and a wrapping row of pill links, one per platform (or search). Each link opens in a new tab and
 * is named "Listen on <platform>".
 */
export function ListenOnRow({ entry }: ListenOnRowProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs text-muted">Listen on</p>
      <ul className="flex flex-wrap gap-1.5">
        {listenOnLinks(entry).map((link) => (
          <li key={link.key}>
            <ExternalLink plain href={link.href} className={PILL_CLASS}>
              <VisuallyHidden>Listen on</VisuallyHidden>{' '}
              <PlatformIcon platform={link.key} label={link.label} />
              <span>{link.label}</span>
            </ExternalLink>
          </li>
        ))}
      </ul>
    </div>
  );
}
