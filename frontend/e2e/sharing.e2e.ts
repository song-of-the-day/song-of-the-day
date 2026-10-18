import { expect, stubExternalRequests, test, watchCspViolations } from './fixtures';
import {
  entryDialog,
  localDate,
  newAccount,
  openCustomize,
  profilePath,
  seedAccount,
  seedItunesEntry,
  themeVar,
} from './helpers';

// Reading the copied link needs clipboard permissions in the test browser.
test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

test('the owner copies the link; a logged-out visitor sees a read-only page in the owner theme', async ({
  page,
  browser,
  baseURL,
}) => {
  const base = baseURL ?? 'http://localhost:8080';
  const origin = new URL(base).origin;
  const account = await seedAccount(page, newAccount());
  const today = localDate();
  await seedItunesEntry(page, {
    trackId: 1003,
    title: 'Midnight City',
    artist: 'M83',
    entry_date: today,
    note: 'headlights on the highway',
  });
  await page.goto(profilePath(account));

  // The owner picks a distinctive preset so the visitor provably sees their theme.
  const sheet = await openCustomize(page);
  await sheet.getByText('Midnight CRT', { exact: true }).click();
  await expect.poll(async () => (await themeVar(page, '--sotd-bg')).toLowerCase()).toBe('#07090c');
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Your page is saved ✦')).toBeVisible();
  await expect(sheet).toBeHidden();

  // Desktop Chromium has no Web Share API, so [Share] falls back to copying the link.
  await page.getByRole('button', { name: 'Share' }).click();
  await expect(page.getByText('Link copied')).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toBe(`${origin}${profilePath(account)}`);

  // A fresh, logged-out browser context opens the shared link.
  const visitor = await browser.newContext({
    baseURL: base,
    timezoneId: 'America/Toronto',
    locale: 'en-CA',
  });
  const unexpected = await stubExternalRequests(visitor, origin);
  const visitorPage = await visitor.newPage();
  const cspViolations = await watchCspViolations(visitorPage);
  const response = await visitorPage.goto(profilePath(account));
  expect(response?.headers()['x-robots-tag']).toBe('noindex, nofollow');
  await expect(visitorPage.locator('meta[name="robots"]')).toHaveAttribute(
    'content',
    'noindex, nofollow',
  );

  // The profile renders in the owner's theme, read-only.
  await expect(
    visitorPage.getByRole('heading', { level: 1, name: account.username }),
  ).toBeVisible();
  expect((await themeVar(visitorPage, '--sotd-bg')).toLowerCase()).toBe('#07090c');
  // The header (no separate top bar) carries the home-linked wordmark and the auth CTAs.
  const visitorHeader = visitorPage.getByRole('banner');
  await expect(visitorHeader.getByRole('link', { name: /song of the day/ })).toHaveAttribute(
    'href',
    '/',
  );
  await expect(visitorHeader.getByRole('link', { name: 'Log in' })).toBeVisible();
  await expect(visitorHeader.getByRole('link', { name: 'Start your own' })).toBeVisible();
  for (const name of ['Customize', 'Account', 'Share', "Log today's song", 'Log a day']) {
    await expect(visitorPage.getByRole('button', { name })).toHaveCount(0);
  }

  // The entry opens read-only: no edit/delete, no note editing.
  await visitorPage.getByRole('button', { name: /Open Midnight City by M83/ }).click();
  const detail = entryDialog(visitorPage, today);
  await expect(detail).toBeVisible();
  await expect(detail.getByText('headlights on the highway')).toBeVisible();
  await expect(detail.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0);
  await expect(detail.getByRole('button', { name: 'Delete entry', exact: true })).toHaveCount(0);
  await expect(detail.getByRole('button', { name: 'Add a note' })).toHaveCount(0);
  await expect(detail.getByText('No notes on this one.')).toBeVisible();

  expect(unexpected, 'requests that would have left the machine').toEqual([]);
  expect(cspViolations, 'Content-Security-Policy violations').toEqual([]);
  await visitor.close();
});

test('an unknown username shows the nobody-here page', async ({ page }) => {
  await page.goto('/nobody-here-xyz');
  await expect(page.getByRole('heading', { level: 1, name: "nobody's here ✦" })).toBeVisible();
  await expect(
    page.getByText("There's no journal at this link. It may have moved to a new name."),
  ).toBeVisible();
});
