import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Theme } from '@/api/types';
import { applyPreset, defaultTheme, withField } from '@/lib/theme';
import { fakeApi } from '@/test/fakeApi';
import { FIXED_NOW, FIXED_TODAY, makeEntryDetail } from '@/test/fixtures';
import { renderApp } from '@/test/routes';

const midnight = applyPreset(defaultTheme(), 'midnight-crt');
const bubblegum = applyPreset(defaultTheme(), 'bubblegum');

// Stand-ins for the other features' dialogs that drive their documented contracts.
vi.mock('@/features/customize/CustomizeSheet', () => ({
  CustomizeSheet: ({
    open,
    onOpenChange,
    onPreviewChange,
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onPreviewChange: (theme: Theme | null) => void;
  }) =>
    open ? (
      <div role="dialog" aria-label="customize">
        <button
          type="button"
          onClick={() => {
            onPreviewChange(bubblegum);
          }}
        >
          Preview bubblegum
        </button>
        <button
          type="button"
          onClick={() => {
            onOpenChange(false);
          }}
        >
          Close customize
        </button>
      </div>
    ) : null,
}));

vi.mock('@/features/account/AccountDialog', () => ({
  AccountDialog: ({ open }: { open: boolean }) =>
    open ? <div role="dialog" aria-label="account" /> : null,
}));

vi.mock('@/features/entries/EntryDetailDialog', () => ({
  EntryDetailDialog: ({
    username,
    entryId,
    onClose,
    readOnly,
  }: {
    username: string;
    entryId: number | null;
    onClose: () => void;
    readOnly: boolean;
  }) =>
    entryId === null ? null : (
      <div role="dialog" aria-label={`song details ${String(entryId)}`}>
        <p>{`${username}${readOnly ? ' read-only' : ' editable'}`}</p>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
    ),
}));

// The real player is exercised in TodayPlayer.test; here we only check what ProfilePage passes it.
vi.mock('./TodayPlayer', () => ({
  TodayPlayer: ({
    username,
    today,
    autoPlay,
  }: {
    username: string;
    today: string;
    autoPlay: boolean;
  }) => (
    <div
      data-testid="today-player"
      data-username={username}
      data-today={today}
      data-autoplay={String(autoPlay)}
    />
  ),
}));

vi.mock('@/features/entries/LogEntryDialog', () => ({
  LogEntryDialog: ({
    open,
    initialDate,
    onOpenChange,
    onSaved,
    onOpenExisting,
  }: {
    open: boolean;
    initialDate?: string;
    onOpenChange: (open: boolean) => void;
    onSaved?: (entry: ReturnType<typeof makeEntryDetail>) => void;
    onOpenExisting?: (entryId: number) => void;
  }) =>
    open ? (
      <div role="dialog" aria-label={`log a song for ${initialDate ?? 'no date'}`}>
        <button
          type="button"
          onClick={() => {
            onSaved?.(makeEntryDetail({ id: 31 }));
            onOpenChange(false);
          }}
        >
          Save
        </button>
        <button
          type="button"
          onClick={() => {
            onOpenExisting?.(17);
            onOpenChange(false);
          }}
        >
          Open it
        </button>
        <button
          type="button"
          onClick={() => {
            onOpenChange(false);
          }}
        >
          Cancel
        </button>
      </div>
    ) : null,
}));

function cssVar(name: string): string {
  return document.documentElement.style.getPropertyValue(name);
}

async function renderProfile(route = '/ada', theme: Theme = midnight) {
  const user = fakeApi.seedUser({
    username: 'ada',
    display_name: 'Ada',
    bio: 'currently obsessed\nwith breakbeats',
    theme,
  });
  const view = renderApp(route, { user });
  // `hidden`: an open dialog may hide the page from the accessibility tree.
  await screen.findByRole('heading', { level: 1, name: 'Ada', hidden: true });
  return { ...view, user };
}

function toolbar() {
  return within(screen.getByRole('main'));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(FIXED_NOW);
});

afterEach(() => {
  vi.useRealTimers();
  document.documentElement.removeAttribute('style');
});

describe('ProfilePage', () => {
  it('keeps Share in the header and Customize/Account in the floating dock', async () => {
    await renderProfile();

    const header = screen.getByRole('banner');
    expect(header).toHaveTextContent('song of the day');
    expect(within(header).getByText(/currently obsessed/)).toHaveClass('whitespace-pre-line');
    expect(within(header).getByRole('button', { name: 'Share' })).toBeInTheDocument();
    expect(within(header).queryByRole('button', { name: 'Customize' })).not.toBeInTheDocument();
    expect(within(header).queryByRole('button', { name: 'Account' })).not.toBeInTheDocument();

    const dock = within(screen.getByRole('contentinfo', { name: 'Settings' }));
    expect(dock.getByRole('button', { name: 'Customize' })).toBeInTheDocument();
    expect(dock.getByRole('button', { name: 'Account' })).toBeInTheDocument();
    // "Ada" only differs from "ada" in case, so the name shows once.
    expect(within(header).queryByText('@ada')).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'song of the day' })).not.toBeInTheDocument();
    expect(document.title).toBe('Ada (@ada) · song of the day');
  });

  describe('share', () => {
    afterEach(() => {
      Reflect.deleteProperty(navigator, 'share');
    });

    it("shares the owner's link under the page's title", async () => {
      const share = vi.fn<(data?: ShareData) => Promise<void>>().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'share', { configurable: true, value: share });
      await renderProfile();

      await userEvent.click(screen.getByRole('button', { name: 'Share' }));

      expect(share).toHaveBeenCalledExactlyOnceWith({
        title: 'Ada (@ada) · song of the day',
        url: `${window.location.origin}/ada`,
      });
    });

    it('copies the link where the Web Share API is missing', async () => {
      const user = userEvent.setup();
      await renderProfile();

      await user.click(screen.getByRole('button', { name: 'Share' }));

      expect(await screen.findByText('Link copied')).toBeInTheDocument();
      await expect(navigator.clipboard.readText()).resolves.toBe(`${window.location.origin}/ada`);
    });
  });

  describe('visitor mode', () => {
    async function renderVisit(route = '/grace', viewer: 'logged-out' | 'other' = 'logged-out') {
      const owner = fakeApi.seedUser({
        username: 'grace',
        display_name: 'Grace',
        bio: 'synths',
        theme: midnight,
      });
      const me = viewer === 'other' ? fakeApi.seedUser({ username: 'ada' }) : null;
      const view = renderApp(route, { user: me });
      await screen.findByRole('heading', { level: 1, name: 'Grace', hidden: true });
      return { ...view, owner };
    }

    it("shows the owner's page and theme without any owner controls", async () => {
      await renderVisit();

      const header = screen.getByRole('banner');
      expect(within(header).getByText('synths')).toBeInTheDocument();
      expect(within(header).queryByRole('button')).not.toBeInTheDocument();
      expect(screen.queryByRole('contentinfo')).not.toBeInTheDocument();
      expect(screen.queryByRole('navigation', { name: 'song of the day' })).not.toBeInTheDocument();
      expect(toolbar().queryByRole('button', { name: "Log today's song" })).toBeNull();
      expect(toolbar().queryByRole('button', { name: 'Log a day' })).toBeNull();
      expect(toolbar().getByRole('radiogroup', { name: 'View' })).toBeInTheDocument();
      expect(cssVar('--sotd-bg')).toBe(midnight.colors.background);
      expect(document.title).toBe('Grace (@grace) · song of the day');
      // The header carries the former top bar: a home-linked wordmark and the auth CTAs.
      expect(within(header).getByRole('link', { name: /song of the day/ })).toHaveAttribute(
        'href',
        '/',
      );
      expect(within(header).getByRole('link', { name: 'Log in' })).toBeInTheDocument();
      expect(within(header).getByRole('link', { name: 'Start your own' })).toBeInTheDocument();
    });

    it('shows logged-in visitors only the home-linked wordmark', async () => {
      await renderVisit('/grace', 'other');

      const header = screen.getByRole('banner');
      expect(within(header).getAllByRole('link')).toHaveLength(1);
      expect(within(header).getByRole('link', { name: /song of the day/ })).toHaveAttribute(
        'href',
        '/',
      );
      expect(within(header).queryByRole('link', { name: 'Log in' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Customize' })).not.toBeInTheDocument();
    });

    it('opens entries read-only', async () => {
      await renderVisit('/grace?entry=12');

      const dialog = screen.getByRole('dialog', { name: 'song details 12' });
      expect(dialog).toHaveTextContent('grace read-only');
    });

    it('keeps empty calendar days inert', async () => {
      const { owner } = await renderVisit('/grace?view=calendar');
      expect(owner.username).toBe('grace');

      expect(await screen.findByRole('grid', { name: 'October 2026' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^Log a song for/ })).not.toBeInTheDocument();
    });
  });

  it('hides an empty bio', async () => {
    const user = fakeApi.seedUser({
      username: 'ada',
      display_name: 'Ada',
      bio: '',
      theme: midnight,
    });
    renderApp('/ada', { user });
    const header = await screen.findByRole('banner');

    expect(header.querySelector('.whitespace-pre-line')).toBeNull();
  });

  it("applies the user's theme to the page and backdrop", async () => {
    await renderProfile();

    expect(cssVar('--sotd-bg')).toBe('#07090C');
    expect(document.querySelector('.sotd-backdrop')).toHaveAttribute('data-pattern', 'scanlines');
  });

  it('previews a draft theme from the customize sheet and drops it on close', async () => {
    await renderProfile();

    await userEvent.click(screen.getByRole('button', { name: 'Customize' }));
    // The dock stays mounted while the sheet is open, so focus can return to [Customize] on close.
    expect(screen.getByRole('contentinfo', { name: 'Settings' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Preview bubblegum' }));
    expect(cssVar('--sotd-bg')).toBe('#FFE3F0');
    expect(document.querySelector('.sotd-backdrop')).toHaveAttribute('data-pattern', 'dots');

    await userEvent.click(screen.getByRole('button', { name: 'Close customize' }));
    expect(cssVar('--sotd-bg')).toBe('#07090C');
  });

  it('opens the account dialog and keeps the dock mounted so focus can return', async () => {
    await renderProfile();

    await userEvent.click(screen.getByRole('button', { name: 'Account' }));

    expect(screen.getByRole('dialog', { name: 'account' })).toBeInTheDocument();
    // The dock (holding the [Account] trigger) must not unmount, or focus can't return to it.
    expect(screen.getByRole('contentinfo', { name: 'Settings' })).toBeInTheDocument();
  });

  describe('today player', () => {
    it("mounts under the header with the username and the owner's autoplay preference", async () => {
      const user = fakeApi.seedUser({
        username: 'ada',
        display_name: 'Ada',
        theme: midnight,
        autoplay_previews: false,
      });
      renderApp('/ada', { user });

      const player = await screen.findByTestId('today-player');
      expect(player).toHaveAttribute('data-username', 'ada');
      expect(player).toHaveAttribute('data-today', FIXED_TODAY);
      expect(player).toHaveAttribute('data-autoplay', 'false');
    });

    it('auto-plays for a logged-out visitor regardless of the owner preference', async () => {
      fakeApi.seedUser({
        username: 'grace',
        display_name: 'Grace',
        theme: midnight,
        autoplay_previews: false,
      });
      renderApp('/grace', { user: null });
      await screen.findByRole('heading', { level: 1, name: 'Grace', hidden: true });

      expect(screen.getByTestId('today-player')).toHaveAttribute('data-autoplay', 'true');
    });
  });

  describe('view', () => {
    it('shows the calendar by default', async () => {
      const { location } = await renderProfile('/ada', defaultTheme());

      expect(await screen.findByRole('grid', { name: 'October 2026' })).toBeInTheDocument();
      expect(screen.getByRole('radio', { name: 'Calendar' })).toBeChecked();
      expect(location().search).toBe('');
    });

    it("follows the theme's default view", async () => {
      await renderProfile('/ada', withField(midnight, { default_view: 'board' }));

      expect(screen.getByRole('radio', { name: 'Board' })).toBeChecked();
      expect(await screen.findByRole('heading', { name: 'no songs yet' })).toBeInTheDocument();
      expect(screen.queryByRole('grid')).not.toBeInTheDocument();
    });

    it('switches views through ?view and keeps the other parameters', async () => {
      const { location } = await renderProfile('/ada?month=2026-08');

      expect(screen.getByRole('radio', { name: 'Calendar' })).toBeChecked();
      expect(await screen.findByRole('grid', { name: 'August 2026' })).toBeInTheDocument();
      await userEvent.click(screen.getByRole('radio', { name: 'Board' }));

      expect(new URLSearchParams(location().search).get('view')).toBe('board');
      expect(new URLSearchParams(location().search).get('month')).toBe('2026-08');
      expect(screen.queryByRole('grid')).not.toBeInTheDocument();

      await userEvent.click(screen.getByRole('radio', { name: 'Calendar' }));
      expect(new URLSearchParams(location().search).get('view')).toBe('calendar');
      expect(await screen.findByRole('grid', { name: 'August 2026' })).toBeInTheDocument();
    });

    it("falls back to the theme's default view from an unknown ?view", async () => {
      await renderProfile('/ada?view=list', withField(midnight, { default_view: 'board' }));

      expect(screen.getByRole('radio', { name: 'Board' })).toBeChecked();
    });
  });

  describe('calendar month', () => {
    it('reads ?month and falls back to the current month when invalid', async () => {
      await renderProfile('/ada?view=calendar&month=2025-02');
      expect(await screen.findByRole('grid', { name: 'February 2025' })).toBeInTheDocument();
    });

    it.each(['2026-13', 'soon', '1899-12'])('falls back from ?month=%s', async (month) => {
      await renderProfile(`/ada?view=calendar&month=${month}`);
      expect(await screen.findByRole('grid', { name: 'October 2026' })).toBeInTheDocument();
    });

    it('stores the month in ?month and drops it for the current month', async () => {
      const { location } = await renderProfile('/ada?view=calendar');

      await userEvent.click(await screen.findByRole('button', { name: 'Previous month' }));
      expect(await screen.findByRole('grid', { name: 'September 2026' })).toBeInTheDocument();
      expect(location().search).toBe('?view=calendar&month=2026-09');

      await userEvent.click(screen.getByRole('button', { name: 'Today' }));
      expect(location().search).toBe('?view=calendar');
    });

    it('opens the log dialog for an empty past day', async () => {
      await renderProfile('/ada?view=calendar');

      await userEvent.click(
        await screen.findByRole('button', { name: 'Log a song for Saturday, October 3, 2026' }),
      );

      expect(screen.getByRole('dialog', { name: 'log a song for 2026-10-03' })).toBeInTheDocument();
    });
  });

  describe("today's song", () => {
    it('offers to log it when today is empty', async () => {
      await renderProfile();

      await userEvent.click(toolbar().getByRole('button', { name: "Log today's song" }));

      expect(
        screen.getByRole('dialog', { name: `log a song for ${FIXED_TODAY}` }),
      ).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('opens it once logged', async () => {
      const user = fakeApi.seedUser({ username: 'ada', display_name: 'Ada', theme: midnight });
      const entry = fakeApi.seedEntry(user.id, {
        entry_date: FIXED_TODAY,
        title: 'Teardrop',
        artist: 'Massive Attack',
      });
      const { location } = renderApp('/ada', { user });

      await userEvent.click(
        await screen.findByRole('button', { name: 'Today: Teardrop — Massive Attack' }),
      );

      expect(location().search).toBe(`?entry=${String(entry.id)}`);
      expect(toolbar().queryByRole('button', { name: "Log today's song" })).toBeNull();
    });
  });

  it("logs any day from '+ Log a day', starting without a date", async () => {
    await renderProfile();

    await userEvent.click(toolbar().getByRole('button', { name: 'Log a day' }));

    expect(screen.getByRole('dialog', { name: 'log a song for no date' })).toBeInTheDocument();
  });

  it('opens the saved entry after logging a song', async () => {
    const { location } = await renderProfile();

    await userEvent.click(toolbar().getByRole('button', { name: "Log today's song" }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(location().search).toBe('?entry=31');
    expect(screen.getByRole('dialog', { name: 'song details 31' })).toBeInTheDocument();
  });

  it('opens the existing entry when the day is already logged', async () => {
    const { location } = await renderProfile();

    await userEvent.click(toolbar().getByRole('button', { name: "Log today's song" }));
    await userEvent.click(screen.getByRole('button', { name: 'Open it' }));

    expect(location().search).toBe('?entry=17');
  });

  describe('entry dialog', () => {
    it('opens from ?entry and removes only that parameter on close', async () => {
      const { location } = await renderProfile('/ada?entry=12&view=calendar');

      expect(screen.getByRole('dialog', { name: 'song details 12' })).toHaveTextContent(
        'ada editable',
      );
      await userEvent.click(screen.getByRole('button', { name: 'Close' }));

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(location().search).toBe('?view=calendar');
    });

    it('opens from a board card and closes with the back button', async () => {
      const user = fakeApi.seedUser({ username: 'ada', display_name: 'Ada', theme: midnight });
      const entry = fakeApi.seedEntry(user.id, { entry_date: '2026-10-09' });
      const { router, location } = renderApp('/ada?view=board', { user });

      await userEvent.click(
        await screen.findByRole('button', {
          name: `Open ${entry.title} by ${entry.artist}, Friday, October 9, 2026`,
        }),
      );
      expect(location().search).toBe(`?view=board&entry=${String(entry.id)}`);
      expect(
        screen.getByRole('dialog', { name: `song details ${String(entry.id)}` }),
      ).toBeInTheDocument();

      await act(async () => {
        await router.navigate(-1);
      });
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(location().search).toBe('?view=board');
    });

    it('closes an in-app opened entry by going back', async () => {
      const { location } = await renderProfile();

      await userEvent.click(toolbar().getByRole('button', { name: "Log today's song" }));
      await userEvent.click(screen.getByRole('button', { name: 'Open it' }));
      await userEvent.click(screen.getByRole('button', { name: 'Close' }));

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(location().search).toBe('');
    });

    it.each(['abc', '0', '-3', '99999999999999999999'])('ignores ?entry=%s', async (id) => {
      await renderProfile(`/ada?entry=${id}`);

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });
});
