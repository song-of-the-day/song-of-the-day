import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { describe, expect, it, vi } from 'vitest';

import { ErrorBoundary } from './ErrorBoundary';
import { ErrorFallback } from './ErrorFallback';
import { RouteError } from './RouteError';

function Broken(): never {
  throw new Error('render failed');
}

describe('ErrorFallback', () => {
  it('explains the problem and offers a reload and a way home', async () => {
    const onReload = vi.fn();
    render(<ErrorFallback onReload={onReload} />);

    expect(
      screen.getByRole('heading', { level: 1, name: 'something went wrong ✦' }),
    ).toBeInTheDocument();
    expect(document.title).toBe('Something went wrong · song of the day');
    expect(screen.getByRole('link', { name: 'Go to the start page' })).toHaveAttribute('href', '/');

    await userEvent.click(screen.getByRole('button', { name: 'Reload page' }));
    expect(onReload).toHaveBeenCalledTimes(1);
  });
});

describe('ErrorBoundary', () => {
  it('renders its children when nothing fails', () => {
    render(
      <ErrorBoundary>
        <p>All good</p>
      </ErrorBoundary>,
    );

    expect(screen.getByText('All good')).toBeInTheDocument();
  });

  it('replaces a failed tree with the fallback', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    render(
      <ErrorBoundary>
        <Broken />
      </ErrorBoundary>,
    );

    expect(screen.getByRole('heading', { name: 'something went wrong ✦' })).toBeInTheDocument();
  });
});

describe('RouteError', () => {
  it('shows the fallback when a route fails to render', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const router = createMemoryRouter(
      [
        {
          path: '/',
          errorElement: <RouteError />,
          children: [{ index: true, element: <Broken /> }],
        },
      ],
      { initialEntries: ['/'] },
    );

    render(<RouterProvider router={router} />);

    expect(screen.getByRole('heading', { name: 'something went wrong ✦' })).toBeInTheDocument();
  });
});
