import { Disc3 } from 'lucide-react';

import { cn } from '@/lib/cn';

export type SpinnerSize = 'sm' | 'md' | 'lg';

const SIZES: Record<SpinnerSize, string> = {
  sm: 'size-4',
  md: 'size-6',
  lg: 'size-10',
};

export interface SpinnerProps {
  size?: SpinnerSize;
  /** What is loading, announced politely. */
  label?: string;
  /**
   * Render only the spinning disc, hidden from assistive technology (e.g. inside a busy button,
   * which conveys the state itself).
   */
  decorative?: boolean;
  className?: string;
}

/**
 * A spinning disc. It stops spinning under `prefers-reduced-motion`; the label still announces
 * the loading state.
 */
export function Spinner({
  size = 'md',
  label = 'Loading…',
  decorative = false,
  className,
}: SpinnerProps) {
  const disc = (
    <Disc3
      aria-hidden="true"
      className={cn('shrink-0 text-accent motion-safe:animate-spin', SIZES[size], className)}
    />
  );
  if (decorative) {
    return disc;
  }
  return (
    <span role="status" className="inline-flex items-center">
      {disc}
      <span className="sr-only">{label}</span>
    </span>
  );
}
