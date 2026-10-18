/**
 * Password-reset links: `{APP_BASE_URL}/reset-password#token=<token>` (the token travels in the
 * fragment, so it never reaches server logs or the Referer header).
 */

export const RESET_PASSWORD_PATH = '/reset-password';

/**
 * Reads the token from a reset link's fragment.
 *
 * @param hash - `location.hash`, including the `#`.
 * @returns The token, or `null` when missing or empty.
 */
export function readResetToken(hash: string): string | null {
  const token = new URLSearchParams(hash.replace(/^#/, '')).get('token')?.trim();
  return token === undefined || token === '' ? null : token;
}
