import type { ComponentPropsWithRef } from 'react';

import { cn } from '@/lib/cn';

export type VisuallyHiddenProps = ComponentPropsWithRef<'span'>;

/**
 * Text for assistive technology only: hidden on screen, still read by screen readers.
 */
export function VisuallyHidden({ className, ...props }: VisuallyHiddenProps) {
  return <span className={cn('sr-only', className)} {...props} />;
}
