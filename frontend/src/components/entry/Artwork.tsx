import { useState } from 'react';

import { cn } from '@/lib/cn';

import { CdPlaceholder } from './CdPlaceholder';

/** Artwork size presets; `fill` takes its container's width. */
export type ArtworkSize = 'sm' | 'md' | 'lg' | 'fill';

interface SizePreset {
  className: string;
  /** Intrinsic size hint for the `<img>` (CSS sets the rendered size). */
  pixels: number;
}

const SIZES: Record<ArtworkSize, SizePreset> = {
  sm: { className: 'size-12', pixels: 48 },
  md: { className: 'size-20', pixels: 80 },
  lg: { className: 'size-48', pixels: 192 },
  // Matches the 600×600 artwork the iTunes search mapping requests.
  fill: { className: 'aspect-square w-full', pixels: 600 },
};

export interface ArtworkProps {
  /** The artwork URL; empty or missing shows the CD placeholder. */
  src: string | null | undefined;
  title: string;
  artist: string;
  /** Size preset (default `md`). For other sizes, use `fill` inside a sized container. */
  size?: ArtworkSize;
  className?: string;
}

/**
 * Square album art with a 1px hairline. The box has a fixed size before the image loads, so
 * nothing shifts. A missing image, or one that fails to load, is replaced by a CD placeholder
 * seeded from the song, which keeps the same accessible name as the image.
 */
export function Artwork({ src, title, artist, size = 'md', className }: ArtworkProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const preset = SIZES[size];
  const label = `${title} by ${artist} artwork`;
  const imageSrc = src ?? '';
  // Tracking the failed URL (not a flag) gives a new URL its own attempt.
  const showImage = imageSrc !== '' && imageSrc !== failedSrc;

  return (
    <span
      role={showImage ? undefined : 'img'}
      aria-label={showImage ? undefined : label}
      className={cn(
        'block shrink-0 overflow-hidden border border-line bg-line/30',
        preset.className,
        className,
      )}
    >
      {showImage ? (
        <img
          src={imageSrc}
          alt={label}
          width={preset.pixels}
          height={preset.pixels}
          loading="lazy"
          decoding="async"
          className="size-full object-cover"
          onError={() => {
            setFailedSrc(imageSrc);
          }}
        />
      ) : (
        // NUL never occurs in titles or artists (the API rejects control characters), so the
        // joined seed is unambiguous.
        <CdPlaceholder seed={`${title}\u0000${artist}`} className="size-full" />
      )}
    </span>
  );
}
