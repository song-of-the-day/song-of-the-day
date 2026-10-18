import { http } from 'msw';
import { describe, expect, it } from 'vitest';

import { defaultTheme, withField } from '@/lib/theme';
import { apiErrorResponse, fakeApi } from '@/test/fakeApi';
import { server } from '@/test/server';

import { updateProfile } from './profile';
import { uploadImage } from './uploads';

function image(type = 'image/png'): File {
  return new File(['image bytes'], 'background.png', { type });
}

function signedIn() {
  const user = fakeApi.seedUser();
  fakeApi.signIn(user.id);
  return user;
}

describe('uploadImage', () => {
  it('uploads the file as multipart field "file"', async () => {
    signedIn();

    const upload = await uploadImage(image());

    expect(upload).toMatchObject({ content_type: 'image/webp', width: 1600, height: 900 });
    expect(upload.url).toBe(`/api/uploads/${upload.id}`);
    expect(fakeApi.hasUpload(upload.id)).toBe(true);
  });

  it('keeps only the saved image and the latest draft', async () => {
    signedIn();
    const saved = await uploadImage(image());
    await updateProfile({
      theme: withField(defaultTheme(), { background: { image_upload_id: saved.id } }),
    });
    const firstDraft = await uploadImage(image());
    const secondDraft = await uploadImage(image());

    expect(fakeApi.hasUpload(saved.id)).toBe(true);
    expect(fakeApi.hasUpload(firstDraft.id)).toBe(false);
    expect(fakeApi.hasUpload(secondDraft.id)).toBe(true);
  });

  it('rejects unsupported formats with unsupported_media_type', async () => {
    signedIn();

    await expect(uploadImage(image('image/svg+xml'))).rejects.toMatchObject({
      status: 415,
      code: 'unsupported_media_type',
    });
  });

  it('surfaces payload_too_large', async () => {
    signedIn();
    server.use(
      http.post('/api/uploads', () =>
        apiErrorResponse(413, 'payload_too_large', 'File is too large.'),
      ),
    );

    await expect(uploadImage(image('image/jpeg'))).rejects.toMatchObject({
      status: 413,
      code: 'payload_too_large',
    });
  });
});

describe('uploadImage errors', () => {
  it('reports a missing file as a validation error', async () => {
    const user = fakeApi.seedUser();
    fakeApi.signIn(user.id);
    const form = new FormData();
    form.append('other', 'value');
    const { apiJson } = await import('./client');

    await expect(apiJson('/uploads', { method: 'POST', body: form })).rejects.toMatchObject({
      code: 'validation_error',
      fields: { file: 'Choose an image to upload.' },
    });
  });
});

describe('GET /api/uploads/<id> (fake API visibility)', () => {
  async function status(url: string): Promise<number> {
    return (await fetch(new URL(url, window.location.origin))).status;
  }

  it('serves the saved background to anyone and drafts only to the owner', async () => {
    signedIn();
    const saved = await uploadImage(image());
    await updateProfile({
      theme: withField(defaultTheme(), { background: { image_upload_id: saved.id } }),
    });
    const draft = await uploadImage(image());

    expect(await status(saved.url)).toBe(200);
    expect(await status(draft.url)).toBe(200);

    fakeApi.signOut();
    expect(await status(saved.url)).toBe(200);
    expect(await status(draft.url)).toBe(404);

    fakeApi.signIn(fakeApi.seedUser().id);
    expect(await status(draft.url)).toBe(404);
    expect(fakeApi.hasUpload(draft.id)).toBe(true);
  });

  it('returns 404 for an unknown upload', async () => {
    expect(await status('/api/uploads/00000000-0000-4000-8000-000000000000')).toBe(404);
  });
});
