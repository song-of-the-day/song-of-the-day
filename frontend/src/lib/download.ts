/**
 * Saving generated files from the browser.
 */

/**
 * Prompts the browser to save a blob as a file.
 *
 * @param blob - The file contents.
 * @param filename - The suggested file name.
 */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
  // Revoke after the click has been handled; some browsers cancel a download revoked synchronously.
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}
