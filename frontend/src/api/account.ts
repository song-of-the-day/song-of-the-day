/**
 * Account endpoints: change password, export data and delete the account.
 */
import { apiResponse, apiVoid } from './client';
import type { ChangePasswordInput, DeleteAccountInput, ExportFile } from './types';

const DEFAULT_EXPORT_FILENAME = 'sotd-export.json';

/**
 * Extracts the filename from a `Content-Disposition` header.
 *
 * @param header - The header value, or `null` when absent.
 * @returns The filename (`filename*=` preferred over `filename=`), or `null` if none is given.
 */
export function filenameFromContentDisposition(header: string | null): string | null {
  if (header === null) {
    return null;
  }
  const extended = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(header);
  if (extended?.[1] !== undefined) {
    try {
      return decodeURIComponent(extended[1].trim());
    } catch {
      // Malformed percent-encoding: fall back to the plain parameter.
    }
  }
  const plain = /filename\s*=\s*(?:"([^"]*)"|([^;]+))/.exec(header);
  const name = (plain?.[1] ?? plain?.[2])?.trim();
  return name === undefined || name === '' ? null : name;
}

/**
 * Changes the password (`POST /api/account/password`). Other sessions end; this one stays.
 *
 * @param input - The current and new passwords.
 */
export async function changePassword(input: ChangePasswordInput): Promise<void> {
  await apiVoid('/account/password', { method: 'POST', body: input });
}

/**
 * Downloads all of the user's data as JSON (`GET /api/account/export`).
 *
 * @returns The file contents and the server-chosen filename.
 */
export async function exportData(): Promise<ExportFile> {
  const response = await apiResponse('/account/export');
  const filename =
    filenameFromContentDisposition(response.headers.get('Content-Disposition')) ??
    DEFAULT_EXPORT_FILENAME;
  return { blob: await response.blob(), filename };
}

/**
 * Deletes the account and everything in it (`DELETE /api/account`). The session ends.
 *
 * @param input - The password, as confirmation.
 */
export async function deleteAccount(input: DeleteAccountInput): Promise<void> {
  await apiVoid('/account', { method: 'DELETE', body: input, rotatesCsrfToken: true });
}
