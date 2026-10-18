import type { CSSProperties } from 'react';

import { cn } from '@/lib/cn';
import { cdPlaceholder } from '@/lib/hash';

export interface CdPlaceholderProps {
  /** Any string that identifies the disc; the same seed always draws the same disc. */
  seed: string;
  /** Classes for the square, e.g. its width (it is `aspect-square` and has no intrinsic size). */
  className?: string;
}

type DiscStyle = CSSProperties & Record<'--cd-disc', string>;

/**
 * Generated "CD" art for songs without artwork: an iridescent disc with a
 * clear hub, a center hole and a soft sheen, on a square faintly tinted with the same colors.
 * The conic gradient's angle and colors are derived from a hash of `seed`. Purely decorative,
 * so it is hidden from assistive technology.
 *
 * The hash library derives discs from a `(title, artist)` pair; here the whole seed is the
 * title and the artist is empty.
 */
export function CdPlaceholder({ seed, className }: CdPlaceholderProps) {
  const style: DiscStyle = { '--cd-disc': cdPlaceholder(seed, '').backgroundImage };
  return (
    <span
      aria-hidden="true"
      data-cd-placeholder=""
      style={style}
      className={cn('relative block aspect-square overflow-hidden bg-surface', className)}
    >
      {/* The jewel case: a faint tint of the disc colors. */}
      <span className="absolute inset-0 bg-(image:--cd-disc) opacity-25" />
      {/* The disc, then its light streaks, clear hub and center hole. */}
      <span className="absolute inset-[8%] overflow-hidden rounded-full border border-line bg-(image:--cd-disc)">
        <span className="absolute inset-0 bg-[linear-gradient(125deg,transparent_22%,var(--y2k-gloss)_40%,transparent_52%,transparent_70%,var(--y2k-gloss)_82%,transparent_92%)]" />
        <span className="absolute inset-[33%] rounded-full border border-line bg-(--y2k-gloss)" />
        <span className="absolute inset-[44%] rounded-full border border-line bg-surface" />
      </span>
    </span>
  );
}
