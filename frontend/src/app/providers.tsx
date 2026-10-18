import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';

import { useClearMeOnUnauthorized } from '@/api/hooks/auth';
import { createQueryClient } from '@/api/queryClient';
import { ToastProvider } from '@/components/ui/Toast';

/** Clears `['me']` when any API call answers `401 unauthorized` (which leads to `/login`). */
function UnauthorizedSync(): null {
  useClearMeOnUnauthorized();
  return null;
}

export interface AppProvidersProps {
  children: ReactNode;
  /** The query client; defaults to one from {@link createQueryClient} (tests pass their own). */
  queryClient?: QueryClient;
}

/**
 * App-wide providers, outside the router: TanStack Query (4xx errors are never retried, other
 * query failures twice), the 401 → logged-out wiring and toasts.
 */
export function AppProviders({ children, queryClient }: AppProvidersProps) {
  const [defaultClient] = useState(createQueryClient);
  return (
    <QueryClientProvider client={queryClient ?? defaultClient}>
      <UnauthorizedSync />
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
}
