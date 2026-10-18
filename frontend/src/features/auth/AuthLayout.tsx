import type { ReactNode } from 'react';

import { CenteredPage } from '@/components/ui/CenteredPage';
import { DocumentTitle } from '@/components/ui/DocumentTitle';
import { Window } from '@/components/ui/Window';
import { Wordmark } from '@/components/ui/Wordmark';

export const AUTH_TAGLINE = 'a private music journal';

export interface AuthLayoutProps {
  /** The window title, the page's `<h1>` (lower-case, heading font), e.g. "log in". */
  title: string;
  /** The document title, e.g. "Log in". */
  documentTitle: string;
  children: ReactNode;
}

/**
 * The frame of every auth page: a centered window on the default theme and backdrop, with the
 * wordmark and tagline above the page's content.
 */
export function AuthLayout({ title, documentTitle, children }: AuthLayoutProps) {
  return (
    <CenteredPage>
      <DocumentTitle title={documentTitle} />
      <Window
        title={title}
        headingLevel={1}
        className="w-full max-w-sm"
        bodyClassName="flex flex-col gap-6 px-5 py-6 sm:px-7 sm:py-8"
      >
        <div className="text-center">
          <Wordmark size="lg" />
          <p className="mt-1 text-sm text-muted">{AUTH_TAGLINE}</p>
        </div>
        {children}
      </Window>
    </CenteredPage>
  );
}
