import { expect, test } from './fixtures';
import { entryDialog, localDate, profilePath, seedAccount, seedItunesEntry } from './helpers';

test('with the matcher disabled a manual YouTube link still works', async ({ page }) => {
  const account = await seedAccount(page);
  const today = localDate();
  const entry = await seedItunesEntry(page, {
    trackId: 1003,
    title: 'Midnight City',
    artist: 'M83',
    entry_date: today,
  });
  await page.goto(`${profilePath(account)}?entry=${String(entry.id)}`);

  // The YouTube field lives in the dialog's edit mode.
  const detail = entryDialog(page, today);
  await detail.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(detail.getByText('Add a YouTube link to take notes while it plays')).toBeVisible();
  await detail.getByRole('button', { name: 'Find it on YouTube' }).click();

  // The e2e stack has no YouTube API key, so the server answers reason "disabled": the UI says
  // so politely instead of showing an error.
  await expect(
    detail.getByText("Didn't find a confident match. Search YouTube or paste a link instead."),
  ).toBeVisible();
  await expect(detail.getByRole('alert')).toHaveCount(0);

  await detail.getByLabel('YouTube link').fill('https://youtu.be/abcdefghijk');
  await detail.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(detail.getByTitle('YouTube video player')).toBeVisible();
});

test('a suggested match can be rejected or used', async ({ page }) => {
  const account = await seedAccount(page);
  const today = localDate();
  const entry = await seedItunesEntry(page, {
    trackId: 1003,
    title: 'Midnight City',
    artist: 'M83',
    entry_date: today,
  });
  await page.route('**/api/songs/youtube-match**', (route) =>
    route.fulfill({
      json: {
        match: {
          video_id: 'zyxwvutsrqp',
          title: 'Midnight City (Official Video)',
          channel_title: 'M83',
          duration_ms: 244_000,
          score: 0.93,
          confidence: 'high',
        },
        reason: 'matched',
      },
    }),
  );
  await page.goto(`${profilePath(account)}?entry=${String(entry.id)}`);
  const detail = entryDialog(page, today);

  await detail.getByRole('button', { name: 'Edit', exact: true }).click();
  await detail.getByRole('button', { name: 'Find it on YouTube' }).click();
  await expect(detail.getByText('Midnight City (Official Video) · M83')).toBeVisible();

  await detail.getByRole('button', { name: 'Not this one' }).click();
  await expect(detail.getByText('Midnight City (Official Video) · M83')).toHaveCount(0);
  await expect(detail.getByRole('button', { name: 'Find it on YouTube' })).toBeVisible();

  await detail.getByRole('button', { name: 'Find it on YouTube' }).click();
  await detail.getByRole('button', { name: 'Use this video' }).click();
  await expect(detail.getByLabel('YouTube link')).toHaveValue(
    'https://www.youtube.com/watch?v=zyxwvutsrqp',
  );

  await detail.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(detail.getByTitle('YouTube video player')).toBeVisible();
});
