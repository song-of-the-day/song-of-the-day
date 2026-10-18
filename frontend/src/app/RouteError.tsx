import { useRouteError } from 'react-router';

import { ErrorFallback } from './ErrorFallback';

/**
 * The router's error element: a page that throws while rendering shows the friendly fallback
 * instead of React Router's developer screen. (The error itself is logged by React Router.)
 */
export function RouteError() {
  // Reading the error marks it handled, so React Router doesn't warn about a missing boundary.
  useRouteError();
  return <ErrorFallback />;
}
