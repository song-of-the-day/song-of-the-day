import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import { SERVER_ERROR_MESSAGE } from '@/api/messages';
import { makeSongResult } from '@/test/fixtures';
import { apiErrorResponse, fakeApi } from '@/test/fakeApi';
import { renderWithProviders } from '@/test/render';
import { server } from '@/test/server';

import {
  FIND_YOUTUBE_MATCH_LABEL,
  NO_YOUTUBE_MATCH_MESSAGE,
  REJECT_VIDEO_LABEL,
  USE_VIDEO_LABEL,
  YouTubeMatchFinder,
} from './YouTubeMatchFinder';

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

function setup(song = makeSongResult()) {
  const user = fakeApi.seedUser();
  const onUse = vi.fn();
  const view = renderWithProviders(<YouTubeMatchFinder song={song} onUse={onUse} />, { user });
  return {
    ...view,
    onUse,
    find: screen.getByRole('button', { name: FIND_YOUTUBE_MATCH_LABEL }),
  };
}

describe('YouTubeMatchFinder', () => {
  it('looks the song up on demand and hands the confirmed video back', async () => {
    fakeApi.setYouTubeMatch({ match: MATCH, reason: 'matched' });
    const { find, onUse } = setup();

    expect(matchRequests()).toHaveLength(0);
    expect(onUse).not.toHaveBeenCalled();
    await userEvent.click(find);

    expect(await screen.findByText(/Matched on YouTube/)).toHaveTextContent(
      'Matched on YouTube: Gosh (Official Video) · Jamie xx',
    );
    expect(matchRequests()).toHaveLength(1);

    await userEvent.click(screen.getByRole('button', { name: USE_VIDEO_LABEL }));

    expect(onUse).toHaveBeenCalledWith(MATCH.video_id);
  });

  it("sends the track's identity to the matcher", async () => {
    fakeApi.setYouTubeMatch({ match: MATCH, reason: 'matched' });
    const { find } = setup(makeSongResult({ duration_ms: 290_973, source_id: '1525506452' }));

    await userEvent.click(find);
    await screen.findByText(/Matched on YouTube/);

    expect(Object.fromEntries(new URLSearchParams(matchRequests()[0]?.search ?? ''))).toEqual({
      title: 'Gosh',
      artist: 'Jamie xx',
      album: 'In Colour',
      duration_ms: '290973',
      source_id: '1525506452',
    });
  });

  it('says so when nothing confident was found', async () => {
    fakeApi.setYouTubeMatch({ match: null, reason: 'no_match' });
    const { find } = setup();

    await userEvent.click(find);

    expect(await screen.findByText(NO_YOUTUBE_MATCH_MESSAGE)).toBeInTheDocument();
    expect(screen.queryByText(/Matched on YouTube/)).not.toBeInTheDocument();
  });

  it('hides a suggestion the user rejects', async () => {
    fakeApi.setYouTubeMatch({ match: MATCH, reason: 'matched' });
    const { find, onUse } = setup();

    await userEvent.click(find);
    await screen.findByText(/Matched on YouTube/);
    await userEvent.click(screen.getByRole('button', { name: REJECT_VIDEO_LABEL }));

    expect(screen.queryByText(/Matched on YouTube/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: FIND_YOUTUBE_MATCH_LABEL })).toBeInTheDocument();
    expect(onUse).not.toHaveBeenCalled();
  });

  it('reports a failed lookup', async () => {
    server.use(
      http.get('/api/songs/youtube-match', () => apiErrorResponse(500, 'internal_error', 'x')),
    );
    const { find } = setup();

    await userEvent.click(find);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(SERVER_ERROR_MESSAGE);
    });
  });

  it('offers the suggestion again when asked after a rejection', async () => {
    fakeApi.setYouTubeMatch({ match: MATCH, reason: 'matched' });
    const { find } = setup();

    await userEvent.click(find);
    await screen.findByText(/Matched on YouTube/);
    await userEvent.click(screen.getByRole('button', { name: REJECT_VIDEO_LABEL }));
    await userEvent.click(screen.getByRole('button', { name: FIND_YOUTUBE_MATCH_LABEL }));

    expect(await screen.findByText(/Matched on YouTube/)).toBeInTheDocument();
  });
});
