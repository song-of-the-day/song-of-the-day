import { RouterProvider } from 'react-router/dom';

import { ErrorBoundary } from './ErrorBoundary';
import { AppProviders } from './providers';
import type { AppRouter } from './router';

export interface AppProps {
  /**
   * The router, created once outside React (see `main.tsx`): creating it during render would
   * subscribe an extra router to the browser history whenever React re-runs that render.
   */
  router: AppRouter;
}

/** The root component: error boundary, app-wide providers and the router. */
export function App({ router }: AppProps) {
  return (
    <ErrorBoundary>
      <AppProviders>
        <RouterProvider router={router} />
      </AppProviders>
    </ErrorBoundary>
  );
}
