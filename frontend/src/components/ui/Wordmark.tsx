import { cn } from '@/lib/cn';

export type WordmarkSize = 'sm' | 'md' | 'lg';

const SIZES: Record<WordmarkSize, string> = {
  sm: 'text-sm',
  md: 'text-xl',
  lg: 'text-2xl sm:text-3xl',
};

export interface WordmarkProps {
  size?: WordmarkSize;
  /** The element to render (default `p`; use `span` inside other text). */
  as?: 'p' | 'span';
  className?: string;
}

/**
 * The "song of the day ✦" wordmark in the heading font. It inherits the text color (pass e.g.
 * `text-muted` to tone it down); the sparkle is decorative and uses the accent.
 */
export function Wordmark({ size = 'md', as: Element = 'p', className }: WordmarkProps) {
  return (
    <Element className={cn('font-heading leading-tight', SIZES[size], className)}>
      song of the day{' '}
      <span aria-hidden="true" className="text-accent">
        ✦
      </span>
    </Element>
  );
}
