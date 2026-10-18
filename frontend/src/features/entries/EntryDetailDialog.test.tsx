import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SERVER_ERROR_MESSAGE } from '@/api/messages';
import { installFakeYouTube } from '@/features/player/testing/fakeYouTube';
import { apiErrorResponse, fakeApi, type SeedEntryOptions } from '@/test/fakeApi';
import { FIXED_NOW, FIXED_TODAY } from '@/test/fixtures';
import { renderWithProviders } from '@/test/render';
import { server } from '@/test/server';

import { LOAD_ERROR_MESSAGE, NOT_FOUND_MESSAGE } from './detail/EntryDetailStates';
import { EntryDetailDialog } from './EntryDetailDialog';

const DIALOG_NAME = 'Sun, Oct 11';
const SONG_WARNING = 'Your 2 notes stay attached; their timestamps were for the previous song.';
const MATCH = {
  video_id: 'dQw4w9WgXcQ',
  title: 'Gosh (Official Video)',
  channel_title: 'Jamie xx',
  duration_ms: 290_000,
  score: 0.93,
  confidence: 'high' as const,
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(FIXED_NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

function setup(options: SeedEntryOptions = {}, noteCount = 0) {
  const user = fakeApi.seedUser();
  const entry = fakeApi.seedEntry(user.id, { entry_date: FIXED_TODAY, ...options });
  for (let index = 0; index < noteCount; index += 1) {
    fakeApi.seedAnnotation(entry.id, { start_ms: index * 10_000, body: `note ${String(index)}` });
  }
  const onClose = vi.fn();
  const view = renderWithProviders(
    <EntryDetailDialog
      username={user.username}
      entryId={entry.id}
      onClose={onClose}
      readOnly={false}
    />,
    { user, route: `/${user.username}?entry=${String(entry.id)}` },
  );
  return { ...view, user, entry, onClose };
}

/** Records the JSON bodies of entry PATCHes, then falls through to the fake API. */
function recordPatches(): unknown[] {
  const bodies: unknown[] = [];
  server.use(
    http.patch('/api/entries/:id', async ({ request }) => {
      bodies.push(await request.clone().json());
    }),
  );
  return bodies;
}

function patchRequests() {
  return fakeApi.requests.filter((request) => request.method === 'PATCH');
}

async function findDialog() {
  return screen.findByRole('dialog', { name: DIALOG_NAME });
}

async function openEditor(dialog: HTMLElement) {
  await userEvent.click(within(dialog).getByRole('button', { name: 'Edit' }));
  const editor = screen.getByRole('dialog', { name: DIALOG_NAME });
  expect(screen.getAllByRole('dialog')).toHaveLength(1);
  return editor;
}

function save() {
  return userEvent.click(screen.getByRole('button', { name: 'Save' }));
}

describe('EntryDetailDialog', () => {
  it('renders nothing while closed', () => {
    renderWithProviders(
      <EntryDetailDialog username="ada" entryId={null} onClose={vi.fn()} readOnly={false} />,
    );

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows a skeleton while the entry loads', async () => {
    setup();

    expect(screen.getByRole('status')).toHaveTextContent('Loading song…');
    expect(await findDialog()).toBeInTheDocument();
    expect(screen.queryByText('Loading song…')).not.toBeInTheDocument();
  });

  it("shows the song's details, note, Listen on row and player", async () => {
    setup({
      title: 'Gosh',
      artist: 'Jamie xx',
      album: 'In Colour',
      note: 'first line\n<b>second</b> line',
      external_url: 'https://open.spotify.com/track/abc',
    });
    const dialog = await findDialog();

    expect(within(dialog).getByRole('heading', { name: 'Gosh' })).toHaveClass('font-body');
    expect(within(dialog).getByText('Jamie xx')).toBeInTheDocument();
    expect(within(dialog).getByText('In Colour')).toBeInTheDocument();
    expect(within(dialog).getByRole('img', { name: 'Gosh by Jamie xx artwork' })).toBeVisible();
    expect(dialog.querySelector(`time[datetime="${FIXED_TODAY}"]`)).not.toBeNull();
    const note = within(dialog).getByText(/first line/);
    expect(note.textContent).toBe('first line\n<b>second</b> line');
    expect(note).toHaveClass('whitespace-pre-line');
    const spotify = within(dialog).getByRole('link', { name: /^Listen on Spotify/ });
    expect(spotify).toHaveAttribute('href', 'https://open.spotify.com/track/abc');
    expect(spotify).toHaveAttribute('target', '_blank');
    expect(spotify).toHaveAttribute('rel', 'noopener noreferrer');
    expect(within(dialog).getByRole('button', { name: 'Play preview' })).toBeInTheDocument();
    expect(
      within(dialog).getByRole('progressbar', { name: 'Preview progress' }),
    ).toBeInTheDocument();
  });

  it('shows one search link per platform without an extra link', async () => {
    setup({ external_url: 'https://music.apple.com/us/album/gosh/1525506447?i=1525506452' });
    const dialog = await findDialog();

    // Apple Music owns the link; the other seven slots are searches, with no extra link.
    expect(within(dialog).getAllByRole('link')).toHaveLength(7);
    expect(within(dialog).getByRole('link', { name: /^Listen on Apple Music/ })).toHaveAttribute(
      'href',
      'https://music.apple.com/song/1525506452',
    );
    expect(within(dialog).queryByRole('link', { name: /^Listen on Bandcamp/ })).toBeNull();
  });

  it('adds one extra link for a host no platform owns', async () => {
    setup({ external_url: 'https://artist.bandcamp.com/track/gosh' });
    const dialog = await findDialog();

    expect(within(dialog).getAllByRole('link')).toHaveLength(8);
    expect(within(dialog).getByRole('link', { name: /^Listen on Bandcamp/ })).toHaveAttribute(
      'href',
      'https://artist.bandcamp.com/track/gosh',
    );
  });

  it('leaves out the album, note and extra link when the entry has none', async () => {
    setup({
      album: null,
      note: null,
      external_url: null,
      source: 'manual',
      source_id: null,
      preview_url: null,
    });
    const dialog = await findDialog();

    expect(within(dialog).queryByText('In Colour')).not.toBeInTheDocument();
    expect(within(dialog).queryByText(/first line/)).not.toBeInTheDocument();
    expect(within(dialog).getAllByRole('link')).toHaveLength(7);
    // A manual song has nothing to play.
    expect(within(dialog).queryByRole('button', { name: /preview/ })).not.toBeInTheDocument();
  });

  it('drops an unparsable external link', async () => {
    setup({ external_url: 'not a url' });
    const dialog = await findDialog();

    expect(within(dialog).getAllByRole('link')).toHaveLength(7);
  });

  it('embeds only the YouTube player when a video is attached', async () => {
    const youtube = installFakeYouTube();
    const { unmount } = setup({ youtube_video_id: 'dQw4w9WgXcQ' });
    const dialog = await findDialog();

    await waitFor(() => {
      expect(youtube.players).toHaveLength(1);
    });
    expect(youtube.latest().options.videoId).toBe('dQw4w9WgXcQ');
    expect(within(dialog).queryByRole('button', { name: 'Play preview' })).not.toBeInTheDocument();

    act(() => {
      youtube.latest().duration = 212;
      youtube.latest().currentTime = 65;
      youtube.latest().fireReady();
    });
    // View mode has no note controls, not even with a ready player.
    expect(within(dialog).queryByRole('button', { name: 'Note at 1:05' })).not.toBeInTheDocument();

    unmount();
    expect(youtube.latest().destroyed).toBe(true);
  });

  it('has no forms or note controls in view mode', async () => {
    setup({}, 2);
    const dialog = await findDialog();

    expect(within(dialog).queryByRole('textbox')).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Add a note' })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Edit note' })).not.toBeInTheDocument();
    // The notes are still listed (on the timeline and as sticky notes).
    expect(within(dialog).getAllByText('note 0')).toHaveLength(2);
    expect(within(dialog).getAllByText('note 1')).toHaveLength(2);
    // Deleting lives in edit mode now.
    expect(within(dialog).queryByRole('button', { name: 'Delete entry' })).not.toBeInTheDocument();
  });

  it('offers no Edit to a visitor', async () => {
    const user = fakeApi.seedUser();
    const entry = fakeApi.seedEntry(user.id);
    renderWithProviders(
      <EntryDetailDialog username={user.username} entryId={entry.id} onClose={vi.fn()} readOnly />,
      { route: `/${user.username}?entry=${String(entry.id)}` },
    );

    const dialog = await findDialog();
    expect(within(dialog).queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
  });

  it('says so when the entry no longer exists, with a single close button', async () => {
    const user = fakeApi.seedUser();
    const onClose = vi.fn();
    renderWithProviders(
      <EntryDetailDialog
        username={user.username}
        entryId={999_999}
        onClose={onClose}
        readOnly={false}
      />,
      { user },
    );

    expect(await screen.findByText(NOT_FOUND_MESSAGE)).toBeInTheDocument();
    // getByRole throws if the title bar showed a second Close button.
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('offers a retry when loading fails for another reason', async () => {
    let failures = 1;
    server.use(
      http.get('/api/users/:username/entries/:id', () => {
        if (failures > 0) {
          failures -= 1;
          return apiErrorResponse(500, 'internal_error', 'Boom.');
        }
        return undefined;
      }),
    );
    setup();

    const alert = (await screen.findByText(LOAD_ERROR_MESSAGE)).closest<HTMLElement>(
      '[role="alert"]',
    );
    if (alert === null) {
      throw new Error('The load error is not an alert');
    }
    expect(alert).toHaveTextContent(SERVER_ERROR_MESSAGE);
    await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }));

    expect(await findDialog()).toBeInTheDocument();
  });

  it('closes from the title bar', async () => {
    const { onClose } = setup();
    const dialog = await findDialog();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes with Escape after a network failure', async () => {
    server.use(http.get('/api/users/:username/entries/:id', () => HttpResponse.error()));
    const { onClose } = setup();

    expect(await screen.findByText(LOAD_ERROR_MESSAGE)).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  describe('edit mode', () => {
    function setupEditable(options: SeedEntryOptions = {}, noteCount = 0) {
      return setup(options, noteCount);
    }

    it('switches the same window into edit mode with the entry prefilled', async () => {
      setupEditable({ note: 'old thoughts', external_url: 'https://open.spotify.com/track/abc' });
      const dialog = await findDialog();

      const editor = await openEditor(dialog);

      expect(within(editor).getByRole('group', { name: 'Chosen song' })).toHaveTextContent('Gosh');
      expect(within(editor).getByLabelText(/^Date/)).toHaveValue(FIXED_TODAY);
      expect(within(editor).getByLabelText(/^Note/)).toHaveValue('old thoughts');
      expect(within(editor).getByLabelText(/^YouTube link/)).toHaveValue('');
      expect(within(editor).getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
      expect(within(editor).getByRole('button', { name: 'Save' })).toBeInTheDocument();
      expect(within(editor).getByRole('button', { name: 'Delete entry' })).toBeInTheDocument();
      // Edit mode hides the "Listen on" row and has no Edit button of its own.
      expect(within(editor).queryByText('Listen on')).not.toBeInTheDocument();
      expect(within(editor).queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    });

    it('keeps the player mounted across the mode switch', async () => {
      const youtube = installFakeYouTube();
      setupEditable({ youtube_video_id: 'dQw4w9WgXcQ' });
      const dialog = await findDialog();
      await waitFor(() => {
        expect(youtube.players).toHaveLength(1);
      });
      act(() => {
        youtube.latest().fireReady();
        youtube.latest().play();
      });

      const editor = await openEditor(dialog);

      expect(youtube.players).toHaveLength(1);
      expect(youtube.latest().destroyed).toBe(false);
      // The ready player still offers note controls in edit mode.
      expect(within(editor).getByRole('button', { name: 'Note at 0:00' })).toBeInTheDocument();
    });

    it('saves only the changed fields and returns to view mode', async () => {
      const bodies = recordPatches();
      const { entry } = setupEditable({ note: 'old thoughts' });
      const dialog = await findDialog();
      const editor = await openEditor(dialog);
      const note = within(editor).getByRole('textbox', { name: /^Note/ });

      await userEvent.clear(note);
      await userEvent.type(note, 'new thoughts');
      await save();

      await waitFor(() => {
        expect(bodies).toEqual([{ note: 'new thoughts' }]);
      });
      expect(await within(editor).findByText('new thoughts')).toBeInTheDocument();
      expect(within(editor).queryByRole('textbox')).not.toBeInTheDocument();
      expect(within(editor).getByRole('button', { name: 'Edit' })).toBeInTheDocument();
      expect(fakeApi.getEntry(entry.id)?.note).toBe('new thoughts');
      expect(await screen.findByText('Saved your changes.')).toBeInTheDocument();
    });

    it('returns to view mode without a request when nothing changed', async () => {
      setupEditable({ note: 'old thoughts' });
      const dialog = await findDialog();
      await openEditor(dialog);

      await save();

      expect(await within(dialog).findByText('old thoughts')).toBeInTheDocument();
      expect(within(dialog).getByRole('button', { name: 'Edit' })).toBeInTheDocument();
      expect(patchRequests()).toHaveLength(0);
    });

    it('shows the API field errors and other failures, staying in edit mode', async () => {
      server.use(
        http.patch(
          '/api/entries/:id',
          () =>
            apiErrorResponse(422, 'validation_error', 'Some fields are invalid.', {
              fields: { note: 'That note is too long.' },
            }),
          { once: true },
        ),
        http.patch('/api/entries/:id', () => apiErrorResponse(500, 'internal_error', 'Boom')),
      );
      setupEditable();
      const dialog = await findDialog();
      const editor = await openEditor(dialog);
      await userEvent.type(within(editor).getByRole('textbox', { name: /^Note/ }), 'a note');

      await save();
      expect(await screen.findByText('That note is too long.')).toBeInTheDocument();
      await waitFor(() => {
        expect(within(editor).getByRole('textbox', { name: /^Note/ })).toHaveFocus();
      });

      await save();
      expect(await screen.findByText(SERVER_ERROR_MESSAGE)).toBeInTheDocument();
      expect(screen.getAllByRole('dialog')).toHaveLength(1);
      expect(within(editor).getByRole('button', { name: 'Save' })).toBeInTheDocument();
    });

    it('asks before dropping unsaved changes and keeps editing when told to', async () => {
      setupEditable({ note: 'old thoughts' });
      const dialog = await findDialog();
      const editor = await openEditor(dialog);
      await userEvent.type(within(editor).getByRole('textbox', { name: /^Note/ }), '!');

      await userEvent.click(within(editor).getByRole('button', { name: 'Cancel' }));

      const confirm = await screen.findByRole('alertdialog');
      expect(confirm).toHaveTextContent('Discard changes?');
      await userEvent.click(within(confirm).getByRole('button', { name: 'Keep editing' }));

      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
      expect(within(editor).getByRole('textbox', { name: /^Note/ })).toHaveValue('old thoughts!');
    });

    it('returns to view mode when the changes are discarded', async () => {
      setupEditable({ note: 'old thoughts' });
      const dialog = await findDialog();
      const editor = await openEditor(dialog);
      await userEvent.type(within(editor).getByRole('textbox', { name: /^Note/ }), '!');

      await userEvent.click(within(editor).getByRole('button', { name: 'Cancel' }));
      const confirm = await screen.findByRole('alertdialog');
      await userEvent.click(within(confirm).getByRole('button', { name: 'Discard' }));

      expect(within(dialog).getByText('old thoughts')).toBeInTheDocument();
      expect(within(dialog).getByRole('button', { name: 'Edit' })).toBeInTheDocument();
      expect(patchRequests()).toHaveLength(0);
    });

    it('asks before closing with unsaved changes, then closes', async () => {
      const { onClose } = setupEditable({ note: 'old thoughts' });
      const dialog = await findDialog();
      const editor = await openEditor(dialog);
      await userEvent.type(within(editor).getByRole('textbox', { name: /^Note/ }), '!');

      await userEvent.keyboard('{Escape}');

      const confirm = await screen.findByRole('alertdialog');
      await userEvent.click(within(confirm).getByRole('button', { name: 'Discard' }));

      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('closes with Escape while nothing changed', async () => {
      const { onClose } = setupEditable();
      const dialog = await findDialog();
      await openEditor(dialog);

      await userEvent.keyboard('{Escape}');

      expect(onClose).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    });

    it('changes the song from search and saves the new song fields', async () => {
      const bodies = recordPatches();
      setupEditable({ title: 'Teardrop', artist: 'Massive Attack', source_id: '1452859418' });
      const dialog = await findDialog();
      const editor = await openEditor(dialog);

      await userEvent.click(within(editor).getByRole('button', { name: 'Change song' }));

      const search = await screen.findByRole('combobox', { name: 'Search for a song' });
      await waitFor(() => {
        expect(search).toHaveFocus();
      });
      await userEvent.type(search, 'gosh');
      await userEvent.click(await screen.findByRole('option', { name: /Gosh/ }));
      expect(within(editor).getByRole('group', { name: 'Chosen song' })).toHaveTextContent('Gosh');

      await save();

      await waitFor(() => {
        expect(bodies).toHaveLength(1);
      });
      expect(bodies[0]).toMatchObject({
        title: 'Gosh',
        artist: 'Jamie xx',
        source_id: '1525506452',
      });
      expect(bodies[0]).not.toHaveProperty('note');
      expect(bodies[0]).not.toHaveProperty('entry_date');
    });

    it('warns that the notes stay attached when the song changes', async () => {
      setupEditable({ title: 'Teardrop', artist: 'Massive Attack', source_id: '1452859418' }, 2);
      const dialog = await findDialog();
      const editor = await openEditor(dialog);
      expect(within(editor).queryByText(SONG_WARNING)).not.toBeInTheDocument();

      await userEvent.click(within(editor).getByRole('button', { name: 'Change song' }));
      await userEvent.type(
        await screen.findByRole('combobox', { name: 'Search for a song' }),
        'gosh',
      );
      await userEvent.click(await screen.findByRole('option', { name: /Gosh/ }));

      expect(within(editor).getByText(SONG_WARNING)).toBeInTheDocument();
    });

    it("edits a manual song's length", async () => {
      const bodies = recordPatches();
      setupEditable({
        title: 'Basement Tape',
        artist: 'Me',
        album: null,
        artwork_url: null,
        preview_url: null,
        external_url: null,
        source: 'manual',
        source_id: null,
        duration_ms: 225_000,
      });
      const dialog = await findDialog();
      const editor = await openEditor(dialog);
      const length = within(editor).getByLabelText(/^Length/);
      expect(length).toHaveValue('3:45');

      await userEvent.clear(length);
      await userEvent.type(length, '4:00');
      await save();

      await waitFor(() => {
        expect(bodies).toEqual([{ duration_ms: 240_000 }]);
      });
    });

    it('rejects a malformed length without saving', async () => {
      setupEditable({ source: 'manual', source_id: null, duration_ms: null });
      const dialog = await findDialog();
      const editor = await openEditor(dialog);
      const length = within(editor).getByLabelText(/^Length/);

      await userEvent.type(length, 'four');
      await save();

      expect(within(editor).getByText('Enter the length as m:ss, e.g. 3:45.')).toBeInTheDocument();
      expect(length).toHaveFocus();
      expect(patchRequests()).toHaveLength(0);
    });

    it('offers only "Open it" when the new date is taken', async () => {
      const { user, location } = setupEditable();
      const other = fakeApi.seedEntry(user.id, { entry_date: '2026-10-04' });
      const dialog = await findDialog();
      const editor = await openEditor(dialog);

      const date = within(editor).getByLabelText(/^Date/);
      await userEvent.clear(date);
      await userEvent.type(date, '2026-10-04');
      await save();

      const alert = (await screen.findByText('You already logged Gosh for Sun, Oct 4.')).closest(
        '[role="alert"]',
      );
      expect(alert).not.toBeNull();
      expect(
        within(alert as HTMLElement).queryByRole('button', { name: 'Replace it' }),
      ).not.toBeInTheDocument();
      // The input stays, and the window stays in edit mode.
      expect(date).toHaveValue('2026-10-04');
      expect(within(editor).getByRole('button', { name: 'Save' })).toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: 'Open it' }));

      expect(new URLSearchParams(location().search).get('entry')).toBe(String(other.id));
    });

    it('finds a video on YouTube, fills the field and saves it', async () => {
      fakeApi.setYouTubeMatch({ match: MATCH, reason: 'matched' });
      const bodies = recordPatches();
      setupEditable();
      const dialog = await findDialog();
      const editor = await openEditor(dialog);

      expect(within(editor).getByRole('link', { name: /^Find on YouTube/ })).toHaveAttribute(
        'href',
        'https://www.youtube.com/results?search_query=Jamie%20xx%20Gosh',
      );
      await userEvent.click(within(editor).getByRole('button', { name: 'Find it on YouTube' }));

      expect(await screen.findByText(/Matched on YouTube/)).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Use this video' }));

      expect(within(editor).getByLabelText(/^YouTube link/)).toHaveValue(
        'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      );
      await save();

      await waitFor(() => {
        expect(bodies).toEqual([{ youtube_video_id: 'dQw4w9WgXcQ' }]);
      });
    });

    it('deletes the entry and its notes after confirmation, then closes', async () => {
      const { entry, onClose } = setupEditable({}, 3);
      const dialog = await findDialog();
      const editor = await openEditor(dialog);

      await userEvent.click(within(editor).getByRole('button', { name: 'Delete entry' }));
      const confirm = screen.getByRole('alertdialog');
      expect(confirm).toHaveTextContent("Delete this day's song and its 3 notes?");
      await userEvent.click(within(confirm).getByRole('button', { name: 'Delete' }));

      await waitFor(() => {
        expect(onClose).toHaveBeenCalledTimes(1);
      });
      expect(fakeApi.getEntry(entry.id)).toBeUndefined();
      expect(screen.queryByText(NOT_FOUND_MESSAGE)).not.toBeInTheDocument();
    });

    it('keeps the entry when deleting fails', async () => {
      server.use(
        http.delete('/api/entries/:id', () => apiErrorResponse(500, 'internal_error', 'Boom.')),
      );
      const { entry, onClose } = setupEditable();
      const dialog = await findDialog();
      const editor = await openEditor(dialog);

      await userEvent.click(within(editor).getByRole('button', { name: 'Delete entry' }));
      const confirm = screen.getByRole('alertdialog');
      expect(confirm).toHaveTextContent("Delete this day's song?");
      await userEvent.click(within(confirm).getByRole('button', { name: 'Delete' }));

      expect(await within(confirm).findByText(SERVER_ERROR_MESSAGE)).toBeInTheDocument();
      expect(onClose).not.toHaveBeenCalled();
      expect(fakeApi.getEntry(entry.id)).toBeDefined();
    });
  });
});
