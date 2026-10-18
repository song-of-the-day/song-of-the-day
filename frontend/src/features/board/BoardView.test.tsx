import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BOARD_PAGE_SIZE } from '@/api/hooks/users';
import type { User } from '@/api/types';
import { apiErrorResponse, fakeApi } from '@/test/fakeApi';
import { FIXED_NOW, FIXED_TODAY } from '@/test/fixtures';
import { holdRequest } from '@/test/hold';
import { triggerIntersection } from '@/test/observers';
import { renderWithProviders } from '@/test/render';
import { server } from '@/test/server';

import { BoardView, type BoardViewProps } from './BoardView';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(FIXED_NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

function renderBoard(user: User, props: Partial<BoardViewProps> = {}) {
  const onOpenEntry = vi.fn();
  const onLogToday = vi.fn();
  const view = renderWithProviders(
    <BoardView
      username={user.username}
      readOnly={false}
      cardStyle="window"
      onOpenEntry={onOpenEntry}
      onLogToday={onLogToday}
      {...props}
    />,
    { user },
  );
  return { ...view, onOpenEntry, onLogToday };
}

function cards() {
  return within(screen.getByRole('list', { name: 'Your songs' })).getAllByRole('button');
}

function sentinel(container: HTMLElement): Element {
  const element = container.querySelector('[data-board-sentinel]');
  if (element === null) {
    throw new Error('No board sentinel rendered');
  }
  return element;
}

describe('BoardView', () => {
  it('shows skeleton cards while loading', async () => {
    const user = fakeApi.seedUser();
    const held = holdRequest('get', '/api/users/:username/entries', () =>
      apiErrorResponse(500, 'internal_error', 'Boom'),
    );
    renderBoard(user);

    expect(screen.getByRole('status')).toHaveTextContent('Loading your songs…');
    await waitFor(() => {
      expect(held.calls).toBe(1);
    });
    held.release();
    expect(await screen.findByText("Couldn't load your songs.")).toBeInTheDocument();
  });

  it('lists entries newest first as cards that open their entry', async () => {
    const user = fakeApi.seedUser();
    const [newest] = fakeApi.seedEntries(user.id, 3, FIXED_TODAY);
    const { onOpenEntry } = renderBoard(user);

    expect(await screen.findByRole('heading', { name: 'Your songs' })).toHaveClass('sr-only');
    expect(cards().map((card) => card.getAttribute('aria-label'))).toEqual([
      'Open Song 1 by Jamie xx, Sunday, October 11, 2026',
      'Open Song 2 by Jamie xx, Saturday, October 10, 2026',
      'Open Song 3 by Jamie xx, Friday, October 9, 2026',
    ]);

    await userEvent.click(screen.getByRole('button', { name: /^Open Song 1 by/ }));

    expect(onOpenEntry).toHaveBeenCalledWith(newest?.id);
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it.each(['window', 'polaroid', 'minimal'] as const)(
    'renders cards in the %s card style',
    async (cardStyle) => {
      const user = fakeApi.seedUser();
      fakeApi.seedEntries(user.id, 2, FIXED_TODAY);
      renderBoard(user, { cardStyle });

      await screen.findAllByRole('button', { name: /^Open Song/ });
      expect(cards().map((card) => card.dataset.cardStyle)).toEqual([cardStyle, cardStyle]);
    },
  );

  it('loads older entries with the Load more button', async () => {
    const user = fakeApi.seedUser();
    fakeApi.seedEntries(user.id, BOARD_PAGE_SIZE + 5, FIXED_TODAY);
    renderBoard(user);

    await waitFor(() => {
      expect(cards()).toHaveLength(BOARD_PAGE_SIZE);
    });
    await userEvent.click(screen.getByRole('button', { name: 'Load more' }));

    await waitFor(() => {
      expect(cards()).toHaveLength(BOARD_PAGE_SIZE + 5);
    });
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('loads older entries when the end of the board scrolls into view', async () => {
    const user = fakeApi.seedUser();
    fakeApi.seedEntries(user.id, BOARD_PAGE_SIZE * 2 + 1, FIXED_TODAY);
    const { container } = renderBoard(user);
    await waitFor(() => {
      expect(cards()).toHaveLength(BOARD_PAGE_SIZE);
    });

    triggerIntersection(sentinel(container), false);
    expect(cards()).toHaveLength(BOARD_PAGE_SIZE);

    triggerIntersection(sentinel(container));
    await waitFor(() => {
      expect(cards()).toHaveLength(BOARD_PAGE_SIZE * 2);
    });

    // A fresh observer reports the sentinel again once the page has loaded.
    triggerIntersection(sentinel(container));
    await waitFor(() => {
      expect(cards()).toHaveLength(BOARD_PAGE_SIZE * 2 + 1);
    });
    expect(container.querySelector('[data-board-sentinel]')).toBeNull();
  });

  it('offers a retry when an older page fails to load', async () => {
    const user = fakeApi.seedUser();
    fakeApi.seedEntries(user.id, BOARD_PAGE_SIZE + 1, FIXED_TODAY);
    renderBoard(user);
    await waitFor(() => {
      expect(cards()).toHaveLength(BOARD_PAGE_SIZE);
    });
    server.use(
      http.get(
        '/api/users/:username/entries',
        () => apiErrorResponse(500, 'internal_error', 'Boom'),
        {
          once: true,
        },
      ),
    );

    await userEvent.click(screen.getByRole('button', { name: 'Load more' }));

    expect(await screen.findByText("Couldn't load older songs.")).toBeInTheDocument();
    expect(cards()).toHaveLength(BOARD_PAGE_SIZE);
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => {
      expect(cards()).toHaveLength(BOARD_PAGE_SIZE + 1);
    });
    expect(screen.queryByText("Couldn't load older songs.")).not.toBeInTheDocument();
  });

  it('invites logging today when there are no entries', async () => {
    const user = fakeApi.seedUser();
    const { onLogToday } = renderBoard(user);

    expect(await screen.findByRole('heading', { name: 'no songs yet' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: "Log today's song" }));

    expect(onLogToday).toHaveBeenCalledTimes(1);
  });

  it("shows someone else's songs read-only, without the invitation", async () => {
    const owner = fakeApi.seedUser({ username: 'grace' });
    fakeApi.seedEntries(owner.id, 2, FIXED_TODAY);
    renderWithProviders(
      <BoardView
        username="grace"
        readOnly
        cardStyle="window"
        onOpenEntry={vi.fn()}
        onLogToday={vi.fn()}
      />,
      { user: null },
    );

    expect(screen.getByRole('status')).toHaveTextContent('Loading songs…');
    const list = await screen.findByRole('list', { name: 'Songs' });
    expect(within(list).getAllByRole('button')).toHaveLength(2);
  });

  it('shows an empty board to visitors without "Log today\'s song"', async () => {
    fakeApi.seedUser({ username: 'grace' });
    server.use(
      http.get(
        '/api/users/:username/entries',
        () => apiErrorResponse(500, 'internal_error', 'Boom'),
        {
          once: true,
        },
      ),
    );
    renderWithProviders(
      <BoardView
        username="grace"
        readOnly
        cardStyle="window"
        onOpenEntry={vi.fn()}
        onLogToday={vi.fn()}
      />,
      { user: null },
    );

    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load these songs.");
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: 'no songs yet' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: "Log today's song" })).not.toBeInTheDocument();
  });

  it('shows a load error with a retry', async () => {
    const user = fakeApi.seedUser();
    fakeApi.seedEntries(user.id, 1, FIXED_TODAY);
    server.use(
      http.get(
        '/api/users/:username/entries',
        () => apiErrorResponse(500, 'internal_error', 'Boom'),
        {
          once: true,
        },
      ),
    );
    renderBoard(user);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("Couldn't load your songs.");
    expect(alert).toHaveTextContent('Something went wrong on our side.');

    await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('button', { name: /^Open Song 1 by/ })).toBeInTheDocument();
  });
});
