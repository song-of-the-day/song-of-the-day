import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import { apiErrorResponse, fakeApi } from '@/test/fakeApi';
import { FIXED_TODAY } from '@/test/fixtures';
import { holdRequest } from '@/test/hold';
import { renderWithProviders } from '@/test/render';
import { server } from '@/test/server';

import { CalendarView, type CalendarViewProps } from './CalendarView';

function renderCalendar(props: Partial<CalendarViewProps> = {}) {
  const user = fakeApi.seedUser();
  const logged = fakeApi.seedEntry(user.id, { entry_date: '2026-10-03', title: 'Teardrop' });
  fakeApi.seedEntry(user.id, { entry_date: '2026-09-30', title: 'Elsewhere' });
  const handlers = { onMonthChange: vi.fn(), onOpenEntry: vi.fn(), onLogDate: vi.fn() };
  const view = renderWithProviders(
    <CalendarView
      username={user.username}
      readOnly={false}
      month="2026-10"
      today={FIXED_TODAY}
      {...handlers}
      {...props}
    />,
    { user },
  );
  return { ...view, ...handlers, logged };
}

function grid() {
  return screen.getByRole('grid', { name: 'October 2026' });
}

async function loaded() {
  await screen.findByRole('button', { name: /^Open Teardrop/ });
}

describe('CalendarView', () => {
  it("loads the month's entries into a Sunday-first month grid", async () => {
    renderCalendar();
    await loaded();

    expect(screen.getByRole('heading', { level: 2, name: 'October 2026' })).toHaveAttribute(
      'aria-live',
      'polite',
    );
    expect(
      within(grid())
        .getAllByRole('columnheader')
        .map((header) => header.textContent),
    ).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
    expect(within(grid()).getAllByRole('row')).toHaveLength(6);
    expect(fakeApi.requests.at(-1)?.search).toBe('?start=2026-10-01&end=2026-10-31&limit=31');
  });

  it('opens a logged day, showing its artwork', async () => {
    const { onOpenEntry, logged } = renderCalendar();
    await loaded();

    const day = screen.getByRole('button', {
      name: 'Open Teardrop by Jamie xx, Saturday, October 3, 2026',
    });
    expect(within(day).getByRole('img', { name: 'Teardrop by Jamie xx artwork' })).toBeVisible();
    expect(day).toHaveTextContent('3');
    await userEvent.click(day);

    expect(onOpenEntry).toHaveBeenCalledWith(logged.id);
  });

  it('logs a song for an empty day on or before today', async () => {
    const { onLogDate } = renderCalendar();
    await loaded();

    await userEvent.click(
      screen.getByRole('button', { name: 'Log a song for Thursday, October 1, 2026' }),
    );

    expect(onLogDate).toHaveBeenCalledWith('2026-10-01');
  });

  it('marks today with a dashed outline', async () => {
    renderCalendar();
    await loaded();

    const today = screen.getByRole('button', { name: 'Log a song for Sunday, October 11, 2026' });
    expect(today).toHaveAttribute('aria-current', 'date');
    expect(today).toHaveClass('outline-dashed', 'outline-accent');
    expect(
      screen.getByRole('button', { name: 'Log a song for Saturday, October 10, 2026' }),
    ).not.toHaveAttribute('aria-current');
  });

  it('keeps future days and days outside the month inert', async () => {
    renderCalendar();
    await loaded();

    const buttons = within(grid()).getAllByRole('button');
    expect(buttons).toHaveLength(11);
    expect(screen.queryByRole('button', { name: /October 12, 2026/ })).not.toBeInTheDocument();
    expect(within(grid()).getByText('31')).not.toHaveAttribute('role');
    expect(screen.queryByRole('button', { name: /^Open Elsewhere/ })).not.toBeInTheDocument();
    const cells = within(grid()).getAllByRole('gridcell');
    expect(cells.slice(0, 4).map((cell) => cell.textContent)).toEqual(['', '', '', '']);
  });

  it('keeps empty days inert for visitors but opens logged days', async () => {
    const { onOpenEntry, onLogDate, logged } = renderCalendar({ readOnly: true });
    await loaded();

    expect(within(grid()).getAllByRole('button')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: /^Log a song for/ })).not.toBeInTheDocument();
    const day = screen.getByRole('button', { name: /^Open Teardrop/ });
    expect(day).toHaveAttribute('tabindex', '0');
    await userEvent.click(day);

    expect(onOpenEntry).toHaveBeenCalledWith(logged.id);
    expect(onLogDate).not.toHaveBeenCalled();
  });

  it('keeps every day inert while the month loads', async () => {
    const user = fakeApi.seedUser();
    const held = holdRequest('get', '/api/users/:username/entries', () =>
      apiErrorResponse(500, 'internal_error', 'Boom'),
    );
    renderWithProviders(
      <CalendarView
        username={user.username}
        readOnly={false}
        month="2026-10"
        today={FIXED_TODAY}
        onMonthChange={vi.fn()}
        onOpenEntry={vi.fn()}
        onLogDate={vi.fn()}
      />,
      { user },
    );

    expect(grid()).toHaveAttribute('aria-busy', 'true');
    expect(within(grid()).queryAllByRole('button')).toHaveLength(0);
    expect(within(grid()).getByText('11')).toHaveAttribute('aria-current', 'date');
    await waitFor(() => {
      expect(held.calls).toBe(1);
    });
    held.release();
    expect(await screen.findByText("Couldn't load this month.")).toBeInTheDocument();
  });

  it('retries a month that failed to load', async () => {
    server.use(
      http.get(
        '/api/users/:username/entries',
        () => apiErrorResponse(500, 'internal_error', 'Boom'),
        {
          once: true,
        },
      ),
    );
    renderCalendar();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("Couldn't load this month.");
    expect(within(grid()).queryAllByRole('button')).toHaveLength(0);
    await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }));

    await loaded();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('navigates months with the header controls', async () => {
    const { onMonthChange } = renderCalendar({ month: '2026-01' });

    await userEvent.click(screen.getByRole('button', { name: 'Previous month' }));
    await userEvent.click(screen.getByRole('button', { name: 'Next month' }));
    await userEvent.click(screen.getByRole('button', { name: 'Today' }));

    expect(onMonthChange.mock.calls).toEqual([['2025-12'], ['2026-02'], ['2026-10']]);
  });

  it('allows future months, where every day is inert', async () => {
    renderCalendar({ month: '2026-11' });

    expect(screen.getByRole('heading', { name: 'November 2026' })).toBeInTheDocument();
    const november = screen.getByRole('grid', { name: 'November 2026' });
    await waitFor(() => {
      expect(november).not.toHaveAttribute('aria-busy');
    });
    expect(within(november).queryAllByRole('button')).toHaveLength(0);
  });

  it('stops at the first and last months', () => {
    const { unmount } = renderCalendar({ month: '1900-01' });
    expect(screen.getByRole('button', { name: 'Previous month' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next month' })).toBeEnabled();
    unmount();

    renderCalendar({ month: '9999-12' });
    expect(screen.getByRole('button', { name: 'Next month' })).toBeDisabled();
  });

  describe('keyboard', () => {
    it('gives the grid one tab stop, on today', async () => {
      renderCalendar();
      await loaded();

      const stops = within(grid())
        .getAllByRole('button')
        .filter((button) => button.tabIndex === 0);
      expect(stops.map((button) => button.getAttribute('aria-label'))).toEqual([
        'Log a song for Sunday, October 11, 2026',
      ]);

      await userEvent.click(screen.getByRole('button', { name: 'Today' }));
      await userEvent.tab();
      expect(document.activeElement).toBe(stops[0]);
    });

    it('moves by day and week with the arrows, and to the ends with Home and End', async () => {
      renderCalendar();
      await loaded();
      screen.getByRole('button', { name: /October 11, 2026/ }).focus();

      await userEvent.keyboard('{ArrowRight}');
      expect(document.activeElement).toHaveAccessibleName(/October 11, 2026/);

      await userEvent.keyboard('{ArrowLeft}');
      expect(document.activeElement).toHaveAccessibleName(/October 10, 2026/);
      expect(document.activeElement).toHaveAttribute('tabIndex', '0');

      await userEvent.keyboard('{ArrowUp}');
      expect(document.activeElement).toHaveAccessibleName(/October 3, 2026/);

      await userEvent.keyboard('{ArrowDown}');
      expect(document.activeElement).toHaveAccessibleName(/October 10, 2026/);

      await userEvent.keyboard('{Home}');
      expect(document.activeElement).toHaveAccessibleName(/October 1, 2026/);

      await userEvent.keyboard('{End}');
      expect(document.activeElement).toHaveAccessibleName(/October 11, 2026/);

      await userEvent.keyboard('{Enter}');
      expect(document.activeElement).toHaveAccessibleName(/October 11, 2026/);
    });

    it('puts the tab stop on the first day in past months', async () => {
      renderCalendar({ month: '2026-09' });

      const first = await screen.findByRole('button', {
        name: 'Log a song for Tuesday, September 1, 2026',
      });
      expect(first).toHaveAttribute('tabIndex', '0');
    });
  });
});
