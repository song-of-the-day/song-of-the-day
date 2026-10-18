/**
 * Upload endpoint for background images.
 */
import { apiJson } from './client';
import type { Upload } from './types';

/**
 * Uploads an image as `multipart/form-data` field `file` (`POST /api/uploads`). The server
 * re-encodes it to WebP.
 *
 * @param file - The image (JPEG, PNG, WebP or GIF, ≤ 10 MiB).
 * @returns The stored upload; reference its `id` in `theme.background.image_upload_id`.
 * @throws ApiError `413 payload_too_large`, `415 unsupported_media_type` or `422 invalid_image`.
 */
export async function uploadImage(file: Blob): Promise<Upload> {
  const form = new FormData();
  form.append('file', file);
  const body = await apiJson('/uploads', { method: 'POST', body: form });
  return (body as { upload: Upload }).upload;
}
