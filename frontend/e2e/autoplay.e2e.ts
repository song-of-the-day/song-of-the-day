import type { Locator, Page } from '@playwright/test';

import { expect, stubExternalRequests, test } from './fixtures';
import {
  entryDialog,
  localDate,
  openAccount,
  profilePath,
  seedAccount,
  seedItunesEntry,
  todayButton,
} from './helpers';

/** The state of the newest stub YouTube player (`1` = playing). */
function stubPlayerState(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    const registry = (window as unknown as { __sotdYouTube?: { players: { state: number }[] } })
      .__sotdYouTube;
    return registry?.players.at(-1)?.state ?? null;
  });
}

/**
 * The open entry dialog's own <audio> element. The page can hold a second one: the "today's song"
 * strip under the header, which is not what these tests are about.
 */
function entryAudio(page: Page, date: string): Locator {
  return entryDialog(page, date).locator('audio');
}

/** Whether an <audio> locator is paused (the type weakening is for locator.evaluate). */
function isPaused(audio: Locator): Promise<boolean> {
  return audio.evaluate((element) => (element as HTMLAudioElement).paused);
}

test('opening an entry starts its Apple Music preview by default', async ({ page }) => {
  const account = await seedAccount(page);
  const today = localDate();
  const entry = await seedItunesEntry(page, {
    trackId: 1001,
    title: 'Gosh',
    artist: 'Jamie xx',
    entry_date: today,
  });
  await page.goto(`${profilePath(account)}?entry=${String(entry.id)}`);

  const dialog = entryDialog(page, today);
  const audio = entryAudio(page, today);
  await expect(audio).toHaveCount(1);
  await expect(dialog.getByRole('button', { name: 'Pause preview' })).toBeVisible();
  expect(await isPaused(audio)).toBe(false);
});

test('picking a search result plays its preview while logging', async ({ page }) => {
  await seedAccount(page);
  await page.goto('/profile');
  await todayButton(page).click();

  const dialog = page.getByRole('dialog', { name: 'log a song' });
  await dialog.getByRole('combobox', { name: 'Search for a song' }).fill('gosh');
  await dialog.getByRole('option', { name: /Gosh/ }).click();

  await expect(dialog.getByRole('button', { name: 'Pause preview' })).toBeVisible();
  await expect(dialog.getByRole('progressbar', { name: 'Preview progress' })).toBeVisible();
});

test('an attached YouTube video starts playing when the entry opens', async ({ page }) => {
  const account = await seedAccount(page);
  const today = localDate();
  const entry = await seedItunesEntry(page, {
    trackId: 1005,
    title: 'Teardrop',
    artist: 'Massive Attack',
    entry_date: today,
    youtube_video_id: 'abcdefghijk',
  });
  await page.goto(`${profilePath(account)}?entry=${String(entry.id)}`);
  await expect(entryDialog(page, today)).toBeVisible();

  await expect.poll(() => stubPlayerState(page)).toBe(1);
});

test('turning off auto-play previews stops entry playback', async ({ page }) => {
  const account = await seedAccount(page);
  const today = localDate();
  const entry = await seedItunesEntry(page, {
    trackId: 1001,
    title: 'Gosh',
    artist: 'Jamie xx',
    entry_date: today,
  });
  await page.goto(profilePath(account));

  const dialog = await openAccount(page);
  const toggle = dialog.getByRole('switch', { name: 'Auto-play previews' });
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await dialog.getByRole('button', { name: 'Close' }).click();

  await page.goto(`${profilePath(account)}?entry=${String(entry.id)}`);
  const detail = entryDialog(page, today);
  const audio = entryAudio(page, today);
  await expect(audio).toHaveCount(1);
  await expect(detail.getByRole('button', { name: 'Play preview' })).toBeVisible();
  // Auto-play is a mount effect; give it a settle window before asserting it didn't start.
  await page.waitForTimeout(400);
  expect(await isPaused(audio)).toBe(true);

  // The control still works when pressed.
  await detail.getByRole('button', { name: 'Play preview' }).click();
  await expect(detail.getByRole('button', { name: 'Pause preview' })).toBeVisible();
});

test('a logged-out visitor never gets auto-play, but can press play', async ({
  page,
  browser,
  baseURL,
}) => {
  const base = baseURL ?? 'http://localhost:8080';
  const origin = new URL(base).origin;
  const account = await seedAccount(page);
  const today = localDate();
  const entry = await seedItunesEntry(page, {
    trackId: 1003,
    title: 'Midnight City',
    artist: 'M83',
    entry_date: today,
  });

  const visitor = await browser.newContext({
    baseURL: base,
    timezoneId: 'America/Toronto',
    locale: 'en-CA',
  });
  const unexpected = await stubExternalRequests(visitor, origin);
  const visitorPage = await visitor.newPage();
  await visitorPage.goto(`${profilePath(account)}?entry=${String(entry.id)}`);

  const dialog = entryDialog(visitorPage, today);
  const audio = entryAudio(visitorPage, today);
  await expect(audio).toHaveCount(1);
  await expect(dialog.getByRole('button', { name: 'Play preview' })).toBeVisible();
  await visitorPage.waitForTimeout(400);
  expect(await isPaused(audio)).toBe(true);

  await dialog.getByRole('button', { name: 'Play preview' }).click();
  await expect(dialog.getByRole('button', { name: 'Pause preview' })).toBeVisible();

  expect(unexpected, 'requests that would have left the machine').toEqual([]);
  await visitor.close();
});
