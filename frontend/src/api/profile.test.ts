import { describe, expect, it } from 'vitest';

import { applyPreset, defaultTheme, withField } from '@/lib/theme';
import { fakeApi } from '@/test/fakeApi';

import { updateProfile } from './profile';

function signedIn() {
  const user = fakeApi.seedUser({ bio: 'old bio' });
  fakeApi.signIn(user.id);
  return user;
}

describe('updateProfile', () => {
  it('updates the display name and bio', async () => {
    signedIn();

    await expect(
      updateProfile({ display_name: '  Grace ', bio: 'new bio' }),
    ).resolves.toMatchObject({
      display_name: 'Grace',
      bio: 'new bio',
    });
  });

  it('stores a null or blank bio as an empty string', async () => {
    signedIn();

    await expect(updateProfile({ bio: null })).resolves.toMatchObject({ bio: '' });
    await expect(updateProfile({ bio: '   ' })).resolves.toMatchObject({ bio: '' });
  });

  it('saves a complete theme with upper-cased colors', async () => {
    signedIn();
    const theme = withField(applyPreset(defaultTheme(), 'bubblegum'), {
      colors: { accent: '#abcdef' },
    });

    const user = await updateProfile({ theme });

    expect(user.theme).toEqual({ ...theme, colors: { ...theme.colors, accent: '#ABCDEF' } });
  });

  it('saves a theme that references an owned upload', async () => {
    const user = signedIn();
    const upload = fakeApi.seedUpload(user.id);
    const theme = withField(defaultTheme(), { background: { image_upload_id: upload.id } });

    await expect(updateProfile({ theme })).resolves.toMatchObject({
      theme: { background: { image_upload_id: upload.id } },
    });
  });

  it('rejects an image that is not available', async () => {
    signedIn();
    const other = fakeApi.seedUser();
    const upload = fakeApi.seedUpload(other.id);
    const theme = withField(defaultTheme(), { background: { image_upload_id: upload.id } });

    await expect(updateProfile({ theme })).rejects.toMatchObject({
      code: 'validation_error',
      fields: {
        'theme.background.image_upload_id': 'This image is no longer available; upload it again.',
      },
    });
  });

  it('rejects null display names and unknown theme options', async () => {
    signedIn();
    const theme = { ...defaultTheme(), card_style: 'scrapbook' } as unknown as ReturnType<
      typeof defaultTheme
    >;

    await expect(updateProfile({ display_name: null as unknown as string })).rejects.toMatchObject({
      fields: { display_name: 'Cannot be null.' },
    });
    await expect(updateProfile({ theme })).rejects.toMatchObject({
      fields: { 'theme.card_style': 'Unknown option.' },
    });
  });

  it('changes the username, normalized, and keeps it when unchanged', async () => {
    const user = signedIn();

    await expect(updateProfile({ username: ' Ada-L ' })).resolves.toMatchObject({
      username: 'ada-l',
    });
    await expect(updateProfile({ username: 'ADA-L' })).resolves.toMatchObject({
      username: 'ada-l',
    });
    expect(fakeApi.getUser(user.id)?.username).toBe('ada-l');
  });

  it("rejects someone else's username and invalid ones", async () => {
    fakeApi.seedUser({ username: 'grace' });
    signedIn();

    await expect(updateProfile({ username: 'Grace' })).rejects.toMatchObject({
      status: 409,
      code: 'username_taken',
    });
    await expect(updateProfile({ username: 'no' })).rejects.toMatchObject({
      fields: { username: 'Username must be between 3 and 30 characters.' },
    });
    await expect(updateProfile({ username: null as unknown as string })).rejects.toMatchObject({
      fields: { username: 'Cannot be null.' },
    });
  });

  it('saves the auto-play preference as a strict boolean', async () => {
    signedIn();

    await expect(updateProfile({ autoplay_previews: false })).resolves.toMatchObject({
      autoplay_previews: false,
    });
    await expect(
      updateProfile({ autoplay_previews: 'yes' as unknown as boolean }),
    ).rejects.toMatchObject({ fields: { autoplay_previews: 'Must be a boolean.' } });
  });
});
