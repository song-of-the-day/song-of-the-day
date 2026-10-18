import { expect, test } from './fixtures';
import {
  entryDialog,
  localDate,
  openCustomize,
  profilePath,
  seedAccount,
  seedItunesEntry,
  spokenDate,
  todayButton,
} from './helpers';

test.use({ viewport: { width: 360, height: 740 } });

test('the profile, log dialog, customize sheet and entry detail work at phone width', async ({
  page,
}) => {
  const account = await seedAccount(page);
  const yesterday = localDate(-1);
  await seedItunesEntry(page, {
    trackId: 1002,
    title: 'Loud Places',
    artist: 'Jamie xx',
    entry_date: yesterday,
  });
  await page.goto(profilePath(account));

  await expect(page.getByRole('heading', { level: 1, name: account.username })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow, 'horizontal overflow at 360px').toBeLessThanOrEqual(1);

  // The log dialog fits the viewport and stays usable.
  await todayButton(page).click();
  const logDialog = page.getByRole('dialog', { name: 'log a song' });
  await expect(logDialog).toBeVisible();
  const logBox = await logDialog.boundingBox();
  expect(logBox?.width ?? 0).toBeGreaterThanOrEqual(320);
  await logDialog.getByRole('combobox', { name: 'Search for a song' }).fill('loud places');
  await logDialog.getByRole('button', { name: 'Close' }).click();
  await expect(logDialog).toBeHidden();

  // The customize sheet is a non-modal bottom sheet: the page behind stays reachable.
  const sheet = await openCustomize(page);
  expect(await sheet.getAttribute('aria-modal')).not.toBe('true');
  await expect(page.getByRole('heading', { level: 1, name: account.username })).toBeVisible();
  const sheetBox = await sheet.boundingBox();
  expect(sheetBox?.width ?? 0).toBeGreaterThanOrEqual(320);
  expect((sheetBox?.y ?? 0) + (sheetBox?.height ?? 0)).toBeGreaterThanOrEqual(700);
  await sheet.getByRole('button', { name: 'Close' }).click();
  await expect(sheet).toBeHidden();

  // The entry detail dialog fits and closes again.
  await page
    .getByRole('button', { name: `Open Loud Places by Jamie xx, ${spokenDate(yesterday)}` })
    .click();
  const detail = entryDialog(page, yesterday);
  await expect(detail).toBeVisible();
  const detailBox = await detail.boundingBox();
  expect(detailBox?.width ?? 0).toBeGreaterThanOrEqual(320);
  await detail.getByRole('button', { name: 'Close' }).click();
  await expect(detail).toBeHidden();
});
