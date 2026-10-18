/**
 * Renders the real route table (`app/router.tsx`) in a memory router, for page and navigation
 * tests that should behave exactly like the app.
 */
import type { User } from '@/api/types';
import { routes } from '@/app/router';

import { renderWithProviders, type RenderWithProvidersResult } from './render';

export interface RenderAppOptions {
  /** The logged-in user (`null` = logged out, omitted = let `/api/auth/me` decide). */
  user?: User | null;
}

/**
 * Renders the app's routes at a URL.
 *
 * @param route - The initial path, search and hash.
 * @param options - The logged-in user.
 * @returns The render result with the router and location accessor.
 */
export function renderApp(
  route: string,
  { user }: RenderAppOptions = {},
): RenderWithProvidersResult {
  return renderWithProviders(<></>, { routes, route, user });
}
