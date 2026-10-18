import type { ComponentPropsWithRef } from 'react';

import { TEXT_LINK_CLASS_NAME } from '@/components/ui/TextLink';
import { cn } from '@/lib/cn';

export interface ExternalLinkProps extends Omit<ComponentPropsWithRef<'a'>, 'target' | 'rel'> {
  href: string;
  /** Skip the text-link styling and the ↗ arrow (e.g. for an image link). */
  plain?: boolean;
}

/**
 * A link to another site. It opens in a new tab with `rel="noopener noreferrer"`, shows a ↗
 * arrow, and tells screen-reader users that it opens a new tab.
 */
export function ExternalLink({ plain = false, className, children, ...props }: ExternalLinkProps) {
  return (
    <a
      target="_blank"
      rel="noopener noreferrer"
      className={cn(!plain && TEXT_LINK_CLASS_NAME, className)}
      {...props}
    >
      {children}
      {!plain && <span aria-hidden="true">{'\u00a0↗'}</span>}{' '}
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}
