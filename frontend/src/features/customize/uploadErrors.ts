/**
 * Background image limits and the messages for failed uploads.
 */
import { isApiError } from '@/api/errors';
import { describeApiError } from '@/api/messages';

/** Largest file the API accepts (10 MiB). */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** The `accept` value of the file input. */
export const ACCEPTED_IMAGE_TYPES = 'image/jpeg,image/png,image/webp,image/gif';

export const UPLOAD_HINT = 'JPEG, PNG, WebP or GIF, up to 10 MB.';
export const TOO_LARGE_MESSAGE = 'This image is over 10 MB. Choose a smaller one.';
export const PROCESSED_TOO_LARGE_MESSAGE =
  'This image is too large to use. Try a smaller or more compressed one.';
export const UNSUPPORTED_MESSAGE = "This file type isn't supported. Use a JPEG, PNG, WebP or GIF.";
export const INVALID_IMAGE_MESSAGE =
  "This image couldn't be read. It may be damaged or larger than 8000 × 8000 pixels.";

/**
 * Describes a failed upload.
 *
 * @param error - The upload mutation's error.
 * @returns A sentence for the background section.
 */
export function describeUploadError(error: unknown): string {
  if (!isApiError(error)) {
    return describeApiError(error);
  }
  switch (error.code) {
    case 'payload_too_large':
      // The file passed the client-side check, so the server's re-encoded result was too big.
      return PROCESSED_TOO_LARGE_MESSAGE;
    case 'unsupported_media_type':
      return UNSUPPORTED_MESSAGE;
    case 'invalid_image':
      return INVALID_IMAGE_MESSAGE;
    case 'validation_error':
      return error.fields.file ?? describeApiError(error);
    default:
      return describeApiError(error);
  }
}
