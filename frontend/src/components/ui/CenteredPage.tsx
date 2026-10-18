import type { ReactNode } from 'react';

import { Backdrop } from '@/components/theme/Backdrop';
import { defaultTheme } from '@/lib/theme';

const DEFAULT_BACKGROUND = defaultTheme().background;

export interface CenteredPageProps {
  children: ReactNode;
}

/**
 * A full-height page on the default theme's backdrop with its content centered in a `<main>`
 * landmark. Used by the auth pages, the 404 page, loading and error screens.
 */
export function CenteredPage({ children }: CenteredPageProps) {
  return (
    <>
      <Backdrop background={DEFAULT_BACKGROUND} />
      <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
        {children}
      </main>
    </>
  );
}
