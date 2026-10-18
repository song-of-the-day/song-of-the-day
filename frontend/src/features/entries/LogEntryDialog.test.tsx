import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http } from 'msw';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SERVER_ERROR_MESSAGE } from '@/api/messages';
import type { EntryDetail, User } from '@/api/types';
import { apiErrorResponse, fakeApi } from '@/test/fakeApi';
import { ITUNES_SEARCH_URL, itunesResponse } from '@/test/fakeItunes';
import { FIXED_NOW, FIXED_TODAY } from '@/test/fixtures';
import { renderWithProviders } from '@/test/render';
import { server } from '@/test/server';

import { LogEntryDialog, type LogEntryDialogProps } from './LogEntryDialog';

/** Records the terms sent to iTunes, then falls through to the fake catalog. */
function recordSearches(): string[] {
  const terms: string[] = [];
  server.use(
    http.get(ITUNES_SEARCH_URL, ({ request }) => {
      terms.push(new URL(request.url).searchParams.get('term') ?? '');
    }),
  );
  return terms;
}

/** Records the JSON bodies sent to a route, then falls through to the fake API. */
function recordBodies(path: string): unknown[] {
  const bodies: unknown[] = [];
  server.use(
    http.post(path, async ({ request }) => {
      bodies.push(await request.clone().json());
    }),
  );
  return bodies;
}

function renderDialog(user: User, props: Partial<LogEntryDialogProps> = {}) {
  const onOpenChange = vi.fn();
  const onSaved = vi.fn<(entry: EntryDetail) => void>();
  const view = renderWithProviders(
    <LogEntryDialog
      open
      onOpenChange={onOpenChange}
      onSaved={onSaved}
      initialDate={FIXED_TODAY}
      {...props}
    />,
    { user, route: '/profile?view=calendar' },
  );
  return { ...view, onOpenChange, onSaved };
}

function searchInput() {
  return screen.getByRole('combobox', { name: 'Search for a song' });
}

async function chooseFromSearch(term: string, title: string) {
  await userEvent.type(searchInput(), term);
  await userEvent.click(await screen.findByRole('option', { name: new RegExp(title) }));
  await screen.findByRole('group', { name: 'Chosen song' });
}

async function enterManually(fields: Partial<Record<'Title' | 'Artist' | 'Length', string>>) {
  await userEvent.click(screen.getByRole('button', { name: 'Enter it manually' }));
  for (const [label, value] of Object.entries(fields)) {
    const input = screen.getByLabelText(new RegExp(`^${label}`));
    await userEvent.clear(input);
    await userEvent.type(input, value);
  }
  await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
}

function save() {
  return userEvent.click(screen.getByRole('button', { name: 'Save' }));
}

let user: User;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(FIXED_NOW);
  user = fakeApi.seedUser();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('LogEntryDialog', () => {
  it('renders nothing while closed', () => {
    renderWithProviders(<LogEntryDialog open={false} onOpenChange={vi.fn()} />, { user });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  describe('search step', () => {
    it("focuses the search and names the day it's logging for", async () => {
      renderDialog(user);

      const dialog = screen.getByRole('dialog', { name: 'log a song' });
      expect(dialog).toHaveAccessibleDescription('Logging for Sun, Oct 11');
      await waitFor(() => {
        expect(searchInput()).toHaveFocus();
      });
      expect(screen.getByRole('button', { name: 'Enter it manually' })).toBeInTheDocument();
    });

    it('waits for 2 characters and debounces the search', async () => {
      const terms = recordSearches();
      renderDialog(user);

      await userEvent.type(searchInput(), 'w');
      expect(screen.getByText(/Type at least 2 characters/)).toBeInTheDocument();

      await userEvent.type(searchInput(), 'indowlick');
      expect(terms).toEqual([]);
      expect(await screen.findByRole('option', { name: /Windowlicker/ })).toBeInTheDocument();
      expect(terms).toEqual(['windowlick']);
      expect(screen.getByRole('option', { name: /Windowlicker/ })).toHaveTextContent(
        'Aphex Twin · Windowlicker - EP',
      );
    });

    it('picks a result with the arrow keys and Enter', async () => {
      renderDialog(user);

      await userEvent.type(searchInput(), 'jamie');
      const options = await screen.findAllByRole('option');
      expect(options).toHaveLength(2);
      expect(searchInput()).toHaveAttribute('aria-expanded', 'true');

      await userEvent.keyboard('{ArrowUp}');
      expect(searchInput()).toHaveAttribute('aria-activedescendant', options[1]?.id);
      await userEvent.keyboard('{ArrowDown}');
      expect(options[0]).toHaveAttribute('aria-selected', 'true');
      await userEvent.keyboard('{ArrowDown}{Enter}');

      const chosen = await screen.findByRole('group', { name: 'Chosen song' });
      expect(chosen).toHaveTextContent('Loud Places');
      expect(chosen).toHaveTextContent('Jamie xx · In Colour');
      expect(chosen).toHaveTextContent('4:43');
      await waitFor(() => {
        expect(chosen).toHaveFocus();
      });
    });

    it('ignores Enter and arrows without results', async () => {
      renderDialog(user);

      await userEvent.type(searchInput(), '{ArrowDown}{Enter}');

      expect(searchInput()).not.toHaveAttribute('aria-activedescendant');
      expect(screen.queryByRole('group', { name: 'Chosen song' })).not.toBeInTheDocument();
    });

    it('picks a result by clicking or pressing Enter on it', async () => {
      renderDialog(user);
      await chooseFromSearch('teardrop', 'Teardrop');
      expect(screen.getByRole('group', { name: 'Chosen song' })).toHaveTextContent('Teardrop');

      await userEvent.click(screen.getByRole('button', { name: 'Change song' }));
      const option = await screen.findByRole('option', { name: /Teardrop/ });
      option.focus();
      await userEvent.keyboard(' ');
      expect(await screen.findByRole('group', { name: 'Chosen song' })).toBeInTheDocument();
    });

    it('says "No matches" for a search without results', async () => {
      renderDialog(user);

      await userEvent.type(searchInput(), 'zzzz nothing');

      expect(await screen.findByText('No matches')).toBeInTheDocument();
      expect(screen.queryByRole('option')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Enter it manually' })).toBeInTheDocument();
    });

    it('switches to the manual form with the term when search is unavailable', async () => {
      server.use(http.get(ITUNES_SEARCH_URL, () => itunesResponse({}, 503)));
      renderDialog(user);

      await userEvent.type(searchInput(), 'Some Song');

      expect(
        await screen.findByText('Search is unavailable right now. Enter the song manually.'),
      ).toBeInTheDocument();
      expect(screen.getByLabelText(/^Title/)).toHaveValue('Some Song');
      await waitFor(() => {
        expect(screen.getByLabelText(/^Title/)).toHaveFocus();
      });
    });
  });

  describe('manual song', () => {
    it('validates the form and parses the length', async () => {
      const bodies = recordBodies('/api/entries');
      const { onSaved, onOpenChange } = renderDialog(user);

      await enterManually({ Length: 'three' });
      expect(screen.getByLabelText(/^Title/)).toHaveAccessibleDescription(
        expect.stringContaining('Enter the song title.') as string,
      );
      expect(screen.getByText('Enter the artist.')).toBeInTheDocument();
      expect(screen.getByText('Enter the length as m:ss, e.g. 3:45.')).toBeInTheDocument();
      expect(screen.getByLabelText(/^Title/)).toHaveFocus();

      await userEvent.click(screen.getByRole('button', { name: 'Back to search' }));
      await enterManually({ Title: 'Basement Tape', Artist: 'Me', Length: '3:45' });

      const chosen = screen.getByRole('group', { name: 'Chosen song' });
      expect(chosen).toHaveTextContent('Basement Tape');
      expect(chosen).toHaveTextContent('3:45');
      await save();

      await waitFor(() => {
        expect(onSaved).toHaveBeenCalledOnce();
      });
      expect(bodies[0]).toMatchObject({
        source: 'manual',
        source_id: null,
        title: 'Basement Tape',
        artist: 'Me',
        album: null,
        duration_ms: 225_000,
        entry_date: FIXED_TODAY,
        note: null,
        youtube_video_id: null,
      });
      expect(onOpenChange).toHaveBeenCalledWith(false);
      expect(await screen.findByText('Logged Basement Tape for Sun, Oct 11.')).toBeInTheDocument();
    });

    it('keeps the manual song when changing it again', async () => {
      renderDialog(user);
      await enterManually({ Title: 'Basement Tape', Artist: 'Me' });

      await userEvent.click(screen.getByRole('button', { name: 'Change song' }));
      await userEvent.click(screen.getByRole('button', { name: 'Keep current song' }));
      await userEvent.click(screen.getByRole('button', { name: 'Change song' }));
      await userEvent.click(screen.getByRole('button', { name: 'Enter it manually' }));

      expect(screen.getByLabelText(/^Title/)).toHaveValue('Basement Tape');
      expect(screen.getByLabelText(/^Artist/)).toHaveValue('Me');
    });

    it("shows the API's song field errors on the manual form", async () => {
      server.use(
        http.post('/api/entries', () =>
          apiErrorResponse(422, 'validation_error', 'Some fields are invalid.', {
            fields: { artist: 'That artist name is not allowed.' },
          }),
        ),
      );
      renderDialog(user);
      await enterManually({ Title: 'Basement Tape', Artist: 'Me' });

      await save();

      expect(await screen.findByText('That artist name is not allowed.')).toBeInTheDocument();
      expect(screen.getByLabelText(/^Artist/)).toHaveValue('Me');
      await waitFor(() => {
        expect(screen.getByLabelText(/^Artist/)).toHaveFocus();
      });
    });
  });

  describe('details step', () => {
    it('logs a song with a note and a YouTube link for the given day', async () => {
      const bodies = recordBodies('/api/entries');
      const { onSaved } = renderDialog(user, { initialDate: '2026-10-03' });
      expect(screen.getByRole('dialog')).toHaveAccessibleDescription('Logging for Sat, Oct 3');
      await chooseFromSearch('gosh', 'Gosh');

      const date = screen.getByLabelText(/^Date/);
      expect(date).toHaveValue('2026-10-03');
      expect(date).toHaveAttribute('max', FIXED_TODAY);
      await userEvent.type(screen.getByLabelText(/^Note/), 'on repeat');
      expect(screen.getByText('9 / 5000')).toBeInTheDocument();
      await userEvent.type(screen.getByLabelText(/^YouTube link/), 'not a link');
      await save();

      expect(
        screen.getByText('Paste a YouTube link, e.g. https://youtu.be/dQw4w9WgXcQ.'),
      ).toBeInTheDocument();
      expect(screen.getByLabelText(/^YouTube link/)).toHaveFocus();

      await userEvent.clear(screen.getByLabelText(/^YouTube link/));
      await userEvent.type(
        screen.getByLabelText(/^YouTube link/),
        'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      );
      await save();

      await waitFor(() => {
        expect(onSaved).toHaveBeenCalledOnce();
      });
      expect(bodies[0]).toMatchObject({
        entry_date: '2026-10-03',
        source: 'itunes',
        source_id: '1525506452',
        title: 'Gosh',
        note: 'on repeat',
        youtube_video_id: 'dQw4w9WgXcQ',
      });
      expect(fakeApi.entriesOf(user.id)).toHaveLength(1);
    });

    it('requires a day when opened without one', async () => {
      const bodies = recordBodies('/api/entries');
      renderDialog(user, { initialDate: undefined });

      expect(screen.queryByText(/Logging for/)).not.toBeInTheDocument();
      await chooseFromSearch('gosh', 'Gosh');

      const date = screen.getByLabelText(/^Date/);
      expect(date).toHaveValue('');
      await save();

      expect(screen.getByText('Choose a date.')).toBeInTheDocument();
      await waitFor(() => {
        expect(date).toHaveFocus();
      });
      expect(bodies).toHaveLength(0);

      await userEvent.type(date, FIXED_TODAY);
      expect(screen.getByRole('dialog')).toHaveAccessibleDescription('Logging for Sun, Oct 11');
      await save();

      await waitFor(() => {
        expect(bodies[0]).toMatchObject({ entry_date: FIXED_TODAY });
      });
      expect(fakeApi.entriesOf(user.id)).toHaveLength(1);
    });

    it('closes on Cancel without saving', async () => {
      const { onOpenChange } = renderDialog(user);
      await chooseFromSearch('gosh', 'Gosh');

      await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

      expect(onOpenChange).toHaveBeenCalledWith(false);
      expect(fakeApi.entriesOf(user.id)).toHaveLength(0);
    });

    it('refuses a day after today', async () => {
      renderDialog(user);
      await chooseFromSearch('gosh', 'Gosh');

      const date = screen.getByLabelText(/^Date/);
      await userEvent.clear(date);
      await userEvent.type(date, '2026-10-12');
      await save();

      expect(screen.getByText('Choose today or an earlier day.')).toBeInTheDocument();
      expect(fakeApi.entriesOf(user.id)).toHaveLength(0);
    });

    it('shows API field errors and other failures', async () => {
      server.use(
        http.post(
          '/api/entries',
          () =>
            apiErrorResponse(422, 'validation_error', 'Some fields are invalid.', {
              fields: { note: 'That note is too long.' },
            }),
          { once: true },
        ),
        http.post('/api/entries', () => apiErrorResponse(500, 'internal_error', 'Boom')),
      );
      renderDialog(user);
      await chooseFromSearch('gosh', 'Gosh');

      await save();
      expect(await screen.findByText('That note is too long.')).toBeInTheDocument();

      await save();
      expect(await screen.findByText(SERVER_ERROR_MESSAGE)).toBeInTheDocument();
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });

  describe('YouTube auto-match', () => {
    const MATCH = {
      video_id: 'dQw4w9WgXcQ',
      title: 'Gosh (Official Video)',
      channel_title: 'Jamie xx',
      duration_ms: 290_000,
      score: 0.93,
      confidence: 'high' as const,
    };

    function matchRequests() {
      return fakeApi.requests.filter((request) => request.path === '/api/songs/youtube-match');
    }

    function youtubeField() {
      return screen.getByLabelText(/^YouTube link/);
    }

    it('prefills an iTunes song from the matched video and saves it', async () => {
      fakeApi.setYouTubeMatch({ match: MATCH, reason: 'matched' });
      const bodies = recordBodies('/api/entries');
      renderDialog(user);
      await chooseFromSearch('gosh', 'Gosh');

      await screen.findByText(/Matched on YouTube/);
      expect(youtubeField()).toHaveValue('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
      expect(screen.getByText(/Matched on YouTube/)).toHaveTextContent(
        'Matched on YouTube: Gosh (Official Video) · Jamie xx',
      );
      expect(Object.fromEntries(new URLSearchParams(matchRequests()[0]?.search ?? ''))).toEqual({
        title: 'Gosh',
        artist: 'Jamie xx',
        album: 'In Colour',
        duration_ms: '290973',
        source_id: '1525506452',
      });

      await save();

      await waitFor(() => {
        expect(fakeApi.entriesOf(user.id)).toHaveLength(1);
      });
      expect(bodies[0]).toMatchObject({ youtube_video_id: 'dQw4w9WgXcQ' });
    });

    it('clears the link and remembers the rejection', async () => {
      fakeApi.setYouTubeMatch({ match: MATCH, reason: 'matched' });
      renderDialog(user);
      await chooseFromSearch('gosh', 'Gosh');
      await screen.findByText(/Matched on YouTube/);

      await userEvent.click(screen.getByRole('button', { name: 'Not this one' }));

      expect(youtubeField()).toHaveValue('');
      expect(screen.queryByText(/Matched on YouTube/)).not.toBeInTheDocument();

      // Leaving and returning to the details step does not offer it again.
      await userEvent.click(screen.getByRole('button', { name: 'Change song' }));
      await userEvent.click(screen.getByRole('button', { name: 'Keep current song' }));
      expect(screen.queryByText(/Matched on YouTube/)).not.toBeInTheDocument();
      expect(youtubeField()).toHaveValue('');
      expect(matchRequests()).toHaveLength(1);
    });

    it('stays quiet without a match', async () => {
      renderDialog(user);
      await chooseFromSearch('gosh', 'Gosh');

      expect(matchRequests()).toHaveLength(1);
      expect(youtubeField()).toHaveValue('');
      expect(screen.queryByText(/Matched on YouTube/)).not.toBeInTheDocument();
    });

    it('does not look up a manual song', async () => {
      renderDialog(user);
      await enterManually({ Title: 'Teardrop', Artist: 'Massive Attack' });

      expect(matchRequests()).toHaveLength(0);
      expect(screen.queryByText(/Matched on YouTube/)).not.toBeInTheDocument();
    });
  });

  describe('a day that is already logged', () => {
    function seedExisting() {
      return fakeApi.seedEntry(user.id, {
        entry_date: FIXED_TODAY,
        title: 'Teardrop',
        artist: 'Massive Attack',
        note: 'old note',
        youtube_video_id: null,
      });
    }

    it('keeps the input and opens the existing entry', async () => {
      const existing = seedExisting();
      const onOpenExisting = vi.fn();
      const { onOpenChange } = renderDialog(user, { onOpenExisting });
      await chooseFromSearch('gosh', 'Gosh');
      await userEvent.type(screen.getByLabelText(/^Note/), 'new note');

      await save();

      expect(
        await screen.findByText('You already logged Teardrop for Sun, Oct 11.'),
      ).toBeInTheDocument();
      expect(screen.getByLabelText(/^Note/)).toHaveValue('new note');
      await userEvent.click(screen.getByRole('button', { name: 'Open it' }));
      expect(onOpenExisting).toHaveBeenCalledWith(existing.id);
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it('opens the existing entry through ?entry by default', async () => {
      const existing = seedExisting();
      const { location } = renderDialog(user);
      await chooseFromSearch('gosh', 'Gosh');
      await save();

      await userEvent.click(await screen.findByRole('button', { name: 'Open it' }));

      expect(new URLSearchParams(location().search).get('entry')).toBe(String(existing.id));
      expect(new URLSearchParams(location().search).get('view')).toBe('calendar');
    });

    it('replaces the song and keeps the old note when the new one is empty', async () => {
      const existing = seedExisting();
      const { onSaved } = renderDialog(user);
      await chooseFromSearch('gosh', 'Gosh');
      await save();

      await userEvent.click(await screen.findByRole('button', { name: 'Replace it' }));

      await waitFor(() => {
        expect(onSaved).toHaveBeenCalledOnce();
      });
      expect(fakeApi.getEntry(existing.id)).toMatchObject({
        title: 'Gosh',
        artist: 'Jamie xx',
        note: 'old note',
      });
      expect(await screen.findByText('Replaced the song for Sun, Oct 11.')).toBeInTheDocument();
    });

    it('warns that notes stay attached and replaces the note when given', async () => {
      const existing = seedExisting();
      fakeApi.seedAnnotation(existing.id);
      fakeApi.seedAnnotation(existing.id);
      renderDialog(user);
      await chooseFromSearch('gosh', 'Gosh');
      await userEvent.type(screen.getByLabelText(/^Note/), 'new note');
      await save();

      expect(
        await screen.findByText(
          'Your 2 notes stay attached; their timestamps were for the previous song.',
        ),
      ).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Replace it' }));

      await waitFor(() => {
        expect(fakeApi.getEntry(existing.id)?.note).toBe('new note');
      });
    });

    it('reports a failed replace and keeps the dialog open', async () => {
      seedExisting();
      server.use(
        http.patch('/api/entries/:id', () => apiErrorResponse(500, 'internal_error', 'Boom')),
      );
      const { onSaved } = renderDialog(user);
      await chooseFromSearch('gosh', 'Gosh');
      await save();

      await userEvent.click(await screen.findByRole('button', { name: 'Replace it' }));

      expect(await screen.findByText(SERVER_ERROR_MESSAGE)).toBeInTheDocument();
      expect(onSaved).not.toHaveBeenCalled();
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('clears the conflict when the date changes', async () => {
      seedExisting();
      renderDialog(user);
      await chooseFromSearch('gosh', 'Gosh');
      await save();
      await screen.findByRole('button', { name: 'Open it' });

      await userEvent.clear(screen.getByLabelText(/^Date/));

      expect(screen.queryByRole('button', { name: 'Open it' })).not.toBeInTheDocument();
    });
  });

  it('starts fresh each time it opens and returns focus on close', async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button
            type="button"
            onClick={() => {
              setOpen(true);
            }}
          >
            Log
          </button>
          <LogEntryDialog open={open} onOpenChange={setOpen} />
        </>
      );
    }
    renderWithProviders(<Harness />, { user });
    const trigger = screen.getByRole('button', { name: 'Log' });

    await userEvent.click(trigger);
    await userEvent.type(searchInput(), 'gosh');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();

    await userEvent.click(trigger);
    expect(searchInput()).toHaveValue('');
  });
});
