/**
 * Rendering helpers for component tests.
 *
 * `renderWithProviders` mirrors the app's provider tree: the app's `AppProviders` (TanStack Query,
 * the 401 → clear `['me']` wiring and toasts) with a test QueryClient, around a memory data router
 * (so data-router APIs such as `useBlocker` work).
 */
import { QueryClient } from '@tanstack/react-query';
import {
  render,
  renderHook,
  type RenderHookResult,
  type RenderOptions,
  type RenderResult,
} from '@testing-library/react';
import type { ComponentType, ReactElement, ReactNode } from 'react';
import { createMemoryRouter, type Location, type RouteObject } from 'react-router';
import { RouterProvider } from 'react-router/dom';

import { queryKeys } from '@/api/keys';
import { AppProviders } from '@/app/providers';
import type { User } from '@/api/types';

import { fakeApi } from './fakeApi';

/**
 * Creates a QueryClient for tests: no retries and no garbage collection during a test.
 */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false },
    },
  });
}

function primeUser(queryClient: QueryClient, user: User | null | undefined): void {
  if (user === undefined) {
    return;
  }
  queryClient.setQueryData(queryKeys.me(), user);
  if (user !== null && fakeApi.hasUser(user.id)) {
    fakeApi.signIn(user.id);
  }
}

export interface TestProvidersProps {
  queryClient: QueryClient;
  children: ReactNode;
}

/** The app-level providers every rendered test tree gets (outside the router). */
export function TestProviders({ queryClient, children }: TestProvidersProps) {
  return <AppProviders queryClient={queryClient}>{children}</AppProviders>;
}

export interface RenderWithProvidersOptions extends Omit<RenderOptions, 'wrapper' | 'queries'> {
  /** The initial URL (path, search and hash). Defaults to `/`. */
  route?: string;
  /**
   * The logged-in user, primed into `['me']` (`null` means logged out). If the fake API knows
   * this user, its session is signed in too, so API calls are authorized.
   */
  user?: User | null;
  /** A client to share between renders; defaults to {@link createTestQueryClient}. */
  queryClient?: QueryClient;
  /** Routes to mount instead of rendering `ui` at every path (then `ui` is ignored). */
  routes?: RouteObject[];
  /** An extra wrapper inside the providers and outside the router. */
  wrapper?: ComponentType<{ children: ReactNode }>;
}

export interface RenderWithProvidersResult extends RenderResult {
  queryClient: QueryClient;
  router: ReturnType<typeof createMemoryRouter>;
  /** The router's current location. */
  location: () => Location;
}

/**
 * Renders a component inside the app's providers and a memory router.
 *
 * @param ui - The element to render at every path (unless `options.routes` is given).
 * @param options - Route, logged-in user, query client, custom routes and RTL options.
 * @returns RTL's result plus the query client, router and a current-location accessor.
 */
export function renderWithProviders(
  ui: ReactElement,
  {
    route = '/',
    user,
    queryClient = createTestQueryClient(),
    routes,
    wrapper: Wrapper,
    ...options
  }: RenderWithProvidersOptions = {},
): RenderWithProvidersResult {
  primeUser(queryClient, user);
  const router = createMemoryRouter(routes ?? [{ path: '*', element: ui }], {
    initialEntries: [route],
  });
  const tree = <RouterProvider router={router} />;
  const result = render(
    <TestProviders queryClient={queryClient}>
      {Wrapper === undefined ? tree : <Wrapper>{tree}</Wrapper>}
    </TestProviders>,
    options,
  );
  return { ...result, queryClient, router, location: () => router.state.location };
}

export interface RenderHookWithProvidersOptions {
  /** The logged-in user; see {@link RenderWithProvidersOptions.user}. */
  user?: User | null;
  queryClient?: QueryClient;
}

/**
 * Renders a hook inside the app-level providers (no router).
 *
 * @param hook - The hook to call.
 * @param options - Logged-in user and query client.
 * @returns RTL's hook result plus the query client.
 */
export function renderHookWithProviders<Result>(
  hook: () => Result,
  { user, queryClient = createTestQueryClient() }: RenderHookWithProvidersOptions = {},
): RenderHookResult<Result, unknown> & { queryClient: QueryClient } {
  primeUser(queryClient, user);
  const result = renderHook(hook, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <TestProviders queryClient={queryClient}>{children}</TestProviders>
    ),
  });
  return { ...result, queryClient };
}
