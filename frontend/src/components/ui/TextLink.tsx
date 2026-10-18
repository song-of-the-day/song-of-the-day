import { Link, type LinkProps } from 'react-router';

import { cn } from '@/lib/cn';

/**
 * Text-link styling, also for buttons that read as links: underlined in the accent color, so a
 * link is recognizable without relying on color contrast with the surrounding text.
 */
export const TEXT_LINK_CLASS_NAME =
  'font-medium text-fg underline decoration-accent decoration-2 underline-offset-4 hover:decoration-fg';

/** An in-app text link (React Router `Link`). */
export function TextLink({ className, ...props }: LinkProps) {
  return <Link className={cn(TEXT_LINK_CLASS_NAME, className)} {...props} />;
}
