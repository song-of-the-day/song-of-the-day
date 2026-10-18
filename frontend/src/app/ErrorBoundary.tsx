import { Component, type ReactNode } from 'react';

import { ErrorFallback } from './ErrorFallback';

export interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  failed: boolean;
}

/**
 * The app-level error boundary: if anything outside the router's own error handling throws while
 * rendering (e.g. a provider), it shows {@link ErrorFallback} instead of a blank page. React
 * reports the caught error to the console.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true };
  }

  override render(): ReactNode {
    return this.state.failed ? <ErrorFallback /> : this.props.children;
  }
}
