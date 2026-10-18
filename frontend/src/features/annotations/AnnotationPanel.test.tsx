import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import { useProfileEntry } from '@/api/hooks/users';
import { SERVER_ERROR_MESSAGE } from '@/api/messages';
import type { YouTubePlayerController } from '@/features/player/useYouTubePlayer';
import { PLAYER_STATE } from '@/features/player/youtube';
import { makePlayerController } from '@/features/player/testing/fakeYouTube';
import { apiErrorResponse, fakeApi, type SeedEntryOptions } from '@/test/fakeApi';
import { renderWithProviders } from '@/test/render';
import { server } from '@/test/server';

import {
  AnnotationPanel,
  EMPTY_NOTES_MESSAGE,
  EMPTY_NOTES_READ_ONLY_MESSAGE,
} from './AnnotationPanel';
import { DRAG_HINT } from './AnnotationTimeline';

interface HarnessProps {
  username: string;
  entryId: number;
  player: YouTubePlayerController;
  readOnly?: boolean;
}

/** Renders the panel from the live entry query, as the entry dialog does. */
function Harness({ username, entryId, player, readOnly }: HarnessProps) {
  const { data } = useProfileEntry(username, entryId);
  return data === undefined ? null : (
    <AnnotationPanel entry={data} player={player} readOnly={readOnly} />
  );
}

async function setup({
  entry: entryOptions = {},
  player = makePlayerController(),
  readOnly = false,
}: { entry?: SeedEntryOptions; player?: YouTubePlayerController; readOnly?: boolean } = {}) {
  const user = fakeApi.seedUser();
  const entry = fakeApi.seedEntry(user.id, entryOptions);
  const verse = fakeApi.seedAnnotation(entry.id, {
    start_ms: 95_000,
    end_ms: null,
    body: 'second verse\nhits hard',
    color: 'pink',
  });
  const intro = fakeApi.seedAnnotation(entry.id, {
    start_ms: 10_000,
    end_ms: 30_000,
    body: 'the intro',
    color: 'blue',
  });
  const view = renderWithProviders(
    <Harness username={user.username} entryId={entry.id} player={player} readOnly={readOnly} />,
    { user: readOnly ? null : user },
  );
  const list = await screen.findByRole('list', { name: 'Notes' });
  return { ...view, entry, verse, intro, player, list };
}

function items(list: HTMLElement): HTMLElement[] {
  return within(list).getAllByRole('listitem');
}

function readyPlayer(overrides: Partial<YouTubePlayerController> = {}) {
  return makePlayerController({
    videoId: 'dQw4w9WgXcQ',
    ready: true,
    state: PLAYER_STATE.PAUSED,
    durationMs: 200_000,
    ...overrides,
  });
}

describe('AnnotationPanel', () => {
  it('lists the notes as sticky notes by start time', async () => {
    const { list } = await setup();

    const [first, second] = items(list) as [HTMLElement, HTMLElement];
    expect(first).toHaveTextContent('0:10–0:30');
    expect(first).toHaveTextContent('the intro');
    expect(second).toHaveTextContent('1:35');
    expect(within(second).getByText(/second verse/)).toHaveClass('whitespace-pre-line');
    expect(second).toHaveClass('y2k-note', 'motion-reduce:rotate-0');
    expect(second.style.getPropertyValue('--y2k-note-color')).toBe('#FFC8E1');
  });

  it('offers no player controls without a video', async () => {
    const { list } = await setup();

    expect(screen.queryByRole('button', { name: /^Note at/ })).not.toBeInTheDocument();
    expect(within(list).queryByRole('button', { name: /^Play from/ })).not.toBeInTheDocument();
  });

  it('says so when there are no notes yet', async () => {
    const user = fakeApi.seedUser();
    const entry = fakeApi.seedEntry(user.id);
    renderWithProviders(
      <Harness username={user.username} entryId={entry.id} player={makePlayerController()} />,
      { user },
    );

    expect(await screen.findByText(EMPTY_NOTES_MESSAGE)).toBeInTheDocument();
  });

  it('adds a note through the form and shows it in place', async () => {
    const { list, entry } = await setup();

    await userEvent.click(screen.getByRole('button', { name: 'Add a note' }));
    const form = screen.getByRole('form', { name: 'New note' });
    await userEvent.type(within(form).getByRole('textbox', { name: 'Start' }), '0:50');
    await userEvent.type(within(form).getByRole('textbox', { name: 'Note' }), 'the hook');
    await userEvent.click(within(form).getByRole('button', { name: 'Add note' }));

    await waitFor(() => {
      expect(items(list)).toHaveLength(3);
    });
    expect(items(list)[1]).toHaveTextContent('the hook');
    expect(screen.queryByRole('form', { name: 'New note' })).not.toBeInTheDocument();
    expect(fakeApi.getEntry(entry.id)?.annotation_count).toBe(3);
  });

  it('closes the new note form on cancel', async () => {
    await setup();

    await userEvent.click(screen.getByRole('button', { name: 'Add a note' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('form', { name: 'New note' })).not.toBeInTheDocument();
  });

  it('edits a note in place of its sticky note', async () => {
    const { list, intro } = await setup();

    await userEvent.click(within(list).getByRole('button', { name: 'Edit note at 0:10–0:30' }));
    const form = within(list).getByRole('form', { name: 'Edit note' });
    const end = within(form).getByRole('textbox', { name: 'End (optional)' });
    await userEvent.clear(end);
    await userEvent.click(within(form).getByRole('button', { name: 'Save note' }));

    await waitFor(() => {
      expect(within(list).queryByRole('form')).not.toBeInTheDocument();
    });
    expect(items(list)[0]).toHaveTextContent(/^0:10the intro/);
    expect(fakeApi.getEntry(intro.entry_id)?.annotations[0]?.end_ms).toBeNull();
  });

  it('deletes a note after confirmation', async () => {
    const { list, entry } = await setup();

    await userEvent.click(within(list).getByRole('button', { name: 'Delete note at 1:35' }));
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent('Delete the note at 1:35?');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(items(list)).toHaveLength(1);
    });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(fakeApi.getEntry(entry.id)?.annotations).toHaveLength(1);
  });

  it('keeps the confirmation open with the reason when deleting fails', async () => {
    server.use(
      http.delete('/api/entries/:id/annotations/:annotationId', () =>
        apiErrorResponse(500, 'internal_error', 'Boom.'),
      ),
    );
    const { list } = await setup();

    await userEvent.click(within(list).getByRole('button', { name: 'Delete note at 1:35' }));
    await userEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }),
    );

    expect(await screen.findByText(SERVER_ERROR_MESSAGE)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(items(list)).toHaveLength(2);
  });

  it('selects a note picked on the timeline without a player, scrolling it into view', async () => {
    const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView');
    const { list, player } = await setup();

    await userEvent.click(screen.getByRole('button', { name: '0:10–0:30: the intro' }));

    expect(player.seekTo).toHaveBeenCalledWith(10_000);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', behavior: 'smooth' });
    expect(scrollIntoView.mock.contexts.at(-1)).toBe(items(list)[0]);
    expect(items(list)[0]).toHaveClass('outline-dashed');
  });

  it('seeks a ready player from the timeline and from a note', async () => {
    const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView');
    const { list, player } = await setup({
      entry: { youtube_video_id: 'dQw4w9WgXcQ' },
      player: readyPlayer(),
    });

    await userEvent.click(screen.getByRole('button', { name: /^1:35: second verse/ }));
    expect(player.seekTo).toHaveBeenLastCalledWith(95_000);
    expect(scrollIntoView.mock.contexts.at(-1)).toBe(items(list)[1]);

    await userEvent.click(within(list).getByRole('button', { name: 'Play from 0:10–0:30' }));
    expect(player.seekTo).toHaveBeenLastCalledWith(10_000);
  });

  it('adds a note at the current playback time, in whole seconds', async () => {
    const player = readyPlayer({ currentTimeMs: 61_200 });
    vi.mocked(player.getCurrentTimeMs).mockReturnValue(62_900);
    await setup({ entry: { youtube_video_id: 'dQw4w9WgXcQ' }, player });

    await userEvent.click(screen.getByRole('button', { name: 'Note at 1:01' }));

    const form = screen.getByRole('form', { name: 'New note' });
    expect(within(form).getByRole('textbox', { name: 'Start' })).toHaveValue('1:02');
    expect(within(form).getByRole('textbox', { name: 'End (optional)' })).toHaveValue('');
    expect(within(form).getByRole('textbox', { name: 'Note' })).toHaveFocus();
  });

  it('highlights the notes playing now', async () => {
    const { list } = await setup({
      entry: { youtube_video_id: 'dQw4w9WgXcQ' },
      player: readyPlayer({ state: PLAYER_STATE.PLAYING, currentTimeMs: 20_000 }),
    });

    const [intro, verse] = items(list) as [HTMLElement, HTMLElement];
    expect(intro).toHaveAttribute('aria-current', 'time');
    expect(intro).toHaveTextContent('now playing');
    expect(verse).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('button', { name: '0:10–0:30: the intro' })).toHaveAttribute(
      'aria-current',
      'time',
    );
  });

  it('highlights nothing while paused', async () => {
    const { list } = await setup({
      entry: { youtube_video_id: 'dQw4w9WgXcQ' },
      player: readyPlayer({ currentTimeMs: 20_000 }),
    });

    expect(items(list)[0]).not.toHaveAttribute('aria-current');
  });

  it('opens the form for a range dragged across a timeline of known length', async () => {
    const { container } = await setup({ entry: { duration_ms: 200_000 } });
    const surface = container.querySelector<HTMLElement>('[data-drag-surface]');
    if (surface === null) {
      throw new Error('No drag surface');
    }
    vi.spyOn(surface, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 400, 32));

    fireEvent.pointerDown(surface, { pointerId: 1, button: 0, clientX: 100 });
    fireEvent.pointerUp(surface, { pointerId: 1, clientX: 140 });

    const form = screen.getByRole('form', { name: 'New note' });
    expect(within(form).getByRole('textbox', { name: 'Start' })).toHaveValue('0:50');
    expect(within(form).getByRole('textbox', { name: 'End (optional)' })).toHaveValue('1:10');

    // A second drag replaces the open form's times.
    fireEvent.pointerDown(surface, { pointerId: 2, button: 0, clientX: 200 });
    fireEvent.pointerUp(surface, { pointerId: 2, clientX: 220 });
    expect(screen.getByRole('textbox', { name: 'Start' })).toHaveValue('1:40');
  });

  it('respects reduced motion when scrolling to a note', async () => {
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query) => ({ matches: true, media: query }) as MediaQueryList,
    );
    const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView');
    await setup();

    await userEvent.click(screen.getByRole('button', { name: '0:10–0:30: the intro' }));

    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', behavior: 'auto' });
  });

  describe('read-only (visitor mode)', () => {
    it('shows the timeline and notes without any editing controls', async () => {
      const player = readyPlayer({ durationMs: 200_000 });
      const { list, intro } = await setup({
        entry: { youtube_video_id: null },
        player,
        readOnly: true,
      });

      expect(items(list)).toHaveLength(2);
      expect(screen.queryByRole('button', { name: 'Add a note' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^Note at/ })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^Edit note/ })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^Delete note/ })).not.toBeInTheDocument();
      expect(screen.queryByText(DRAG_HINT)).not.toBeInTheDocument();

      await userEvent.click(within(list).getByRole('button', { name: 'Play from 0:10–0:30' }));
      expect(player.seekTo).toHaveBeenCalledWith(intro.start_ms);
    });

    it('says so when there are no notes', async () => {
      const user = fakeApi.seedUser({ username: 'grace' });
      const entry = fakeApi.seedEntry(user.id);
      renderWithProviders(
        <Harness username="grace" entryId={entry.id} player={makePlayerController()} readOnly />,
        { user: null },
      );

      expect(await screen.findByText(EMPTY_NOTES_READ_ONLY_MESSAGE)).toBeInTheDocument();
    });
  });
});
