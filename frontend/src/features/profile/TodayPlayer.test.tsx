import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { installFakeYouTube } from '@/features/player/testing/fakeYouTube';
import { fakeApi } from '@/test/fakeApi';
import { FIXED_TODAY } from '@/test/fixtures';
import { renderWithProviders } from '@/test/render';

import { TodayPlayer } from './TodayPlayer';

function renderToday(username = 'ada', autoPlay = false) {
  return renderWithProviders(
    <TodayPlayer username={username} today={FIXED_TODAY} autoPlay={autoPlay} />,
    { route: `/${username}` },
  );
}

/** Waits until the day's entries have been read, so an absent strip means "decided", not "loading". */
async function waitForEntriesRead(username = 'ada') {
  await waitFor(() => {
    expect(
      fakeApi.requests.some((request) => request.path === `/api/users/${username}/entries`),
    ).toBe(true);
  });
}

function strip() {
  return within(screen.getByRole('region', { name: "Today's song" }));
}

describe('TodayPlayer', () => {
  it('renders nothing when today has no song', async () => {
    fakeApi.seedUser({ username: 'ada' });
    renderToday();

    await waitForEntriesRead();
    expect(screen.queryByRole('region', { name: "Today's song" })).not.toBeInTheDocument();
  });

  it("renders nothing when today's song has nothing to play", async () => {
    const user = fakeApi.seedUser({ username: 'ada' });
    fakeApi.seedEntry(user.id, {
      entry_date: FIXED_TODAY,
      source: 'manual',
      preview_url: null,
      source_id: null,
      youtube_video_id: null,
    });
    renderToday();

    await waitForEntriesRead();
    expect(screen.queryByRole('region', { name: "Today's song" })).not.toBeInTheDocument();
  });

  it("shows today's song and its Apple preview control", async () => {
    const user = fakeApi.seedUser({ username: 'ada' });
    fakeApi.seedEntry(user.id, { entry_date: FIXED_TODAY, title: 'Gosh', artist: 'Jamie xx' });
    renderToday();

    await screen.findByRole('region', { name: "Today's song" });
    expect(strip().getByText('Gosh')).toBeInTheDocument();
    expect(strip().getByText('Jamie xx')).toBeInTheDocument();
    expect(strip().getByRole('button', { name: 'Play preview' })).toBeInTheDocument();
  });

  it('starts the preview on mount when the viewer auto-plays', async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play');
    const user = fakeApi.seedUser({ username: 'ada' });
    fakeApi.seedEntry(user.id, { entry_date: FIXED_TODAY });
    renderToday('ada', true);

    await screen.findByRole('region', { name: "Today's song" });
    await waitFor(() => {
      expect(play).toHaveBeenCalled();
    });
  });

  it('embeds the YouTube player when the song has a video', async () => {
    const youtube = installFakeYouTube();
    const user = fakeApi.seedUser({ username: 'ada' });
    fakeApi.seedEntry(user.id, { entry_date: FIXED_TODAY, youtube_video_id: 'dQw4w9WgXcQ' });
    renderToday();

    await screen.findByRole('region', { name: "Today's song" });
    // The YouTube player is mounted (not the Apple preview control).
    expect(strip().queryByRole('button', { name: 'Play preview' })).not.toBeInTheDocument();
    await waitFor(() => {
      expect(youtube.players).toHaveLength(1);
    });
  });
});
