/**
 * The YouTube auto-match lookup (`GET /api/songs/youtube-match`).
 *
 * The server caches results per track, so asking again for the same song
 * is cheap. Upstream problems come back as `match: null` with a `reason`, never as an error.
 */
import { apiJson } from './client';
import type { YouTubeMatchQuery, YouTubeMatchResult } from './types';

/**
 * Asks the server for a song's YouTube video.
 *
 * @param query - The track; `title` and `artist` are required.
 * @param signal - Aborts the request.
 * @returns The suggested video, or `null` with the reason there is none.
 * @throws ApiError `401` when logged out, `422` for invalid parameters, `429` when rate-limited.
 */
export async function getYouTubeMatch(
  query: YouTubeMatchQuery,
  signal?: AbortSignal,
): Promise<YouTubeMatchResult> {
  const body = await apiJson('/songs/youtube-match', { query: { ...query }, signal });
  return body as YouTubeMatchResult;
}
