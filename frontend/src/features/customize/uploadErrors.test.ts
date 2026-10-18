import { describe, expect, it } from 'vitest';

import { ApiError } from '@/api/errors';
import { GENERIC_ERROR_MESSAGE, NETWORK_ERROR_MESSAGE } from '@/api/messages';

import {
  describeUploadError,
  INVALID_IMAGE_MESSAGE,
  PROCESSED_TOO_LARGE_MESSAGE,
  UNSUPPORTED_MESSAGE,
} from './uploadErrors';

function apiError(status: number, code: string, fields?: Record<string, string>): ApiError {
  return new ApiError({ status, code, message: 'Server says no.', fields });
}

describe('describeUploadError', () => {
  it.each([
    [413, 'payload_too_large', PROCESSED_TOO_LARGE_MESSAGE],
    [415, 'unsupported_media_type', UNSUPPORTED_MESSAGE],
    [422, 'invalid_image', INVALID_IMAGE_MESSAGE],
    [0, 'network_error', NETWORK_ERROR_MESSAGE],
  ])('explains %i %s', (status, code, message) => {
    expect(describeUploadError(apiError(status, code))).toBe(message);
  });

  it('uses the file field message of a validation error', () => {
    expect(
      describeUploadError(
        apiError(422, 'validation_error', { file: 'Choose an image to upload.' }),
      ),
    ).toBe('Choose an image to upload.');
    expect(describeUploadError(apiError(422, 'validation_error'))).toBe('Server says no.');
  });

  it('falls back to the generic message for unknown errors', () => {
    expect(describeUploadError(new Error('boom'))).toBe(GENERIC_ERROR_MESSAGE);
  });
});
