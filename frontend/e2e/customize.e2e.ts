import { expect, test } from './fixtures';
import { openCustomize, profilePath, seedAccount, themeVar } from './helpers';
import { PNG_1X1 } from './stubs';

test('applying a preset and a color previews live, saves and persists', async ({ page }) => {
  const account = await seedAccount(page);
  await page.goto(profilePath(account));

  const sheet = await openCustomize(page);
  // The radio input is sr-only; the visible label is the user's click target.
  await sheet.getByText('Midnight CRT', { exact: true }).click();
  await expect.poll(async () => (await themeVar(page, '--sotd-bg')).toLowerCase()).toBe('#07090c');

  const accent = sheet.getByLabel('Accent', { exact: true });
  await accent.fill('#ff5500');
  await accent.press('Tab');
  await expect
    .poll(async () => (await themeVar(page, '--sotd-accent')).toLowerCase())
    .toBe('#ff5500');

  await sheet.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Your page is saved ✦')).toBeVisible();
  await expect(sheet).toBeHidden();
  await expect
    .poll(async () => (await themeVar(page, '--sotd-accent')).toLowerCase())
    .toBe('#ff5500');

  await page.reload();
  await expect
    .poll(async () => (await themeVar(page, '--sotd-accent')).toLowerCase())
    .toBe('#ff5500');
});

test('an uploaded background shows behind the page, saves and can be removed', async ({ page }) => {
  const account = await seedAccount(page);
  await page.goto(profilePath(account));
  const backdrop = page.locator('.sotd-backdrop');

  const sheet = await openCustomize(page);
  await sheet
    .getByLabel('Upload image')
    .setInputFiles({ name: 'waves.png', mimeType: 'image/png', buffer: PNG_1X1 });
  await expect(backdrop).toHaveAttribute('style', /\/api\/uploads\//);

  await sheet.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Your page is saved ✦')).toBeVisible();
  await page.reload();
  await expect(backdrop).toHaveAttribute('style', /\/api\/uploads\//);

  const style = await backdrop.evaluate((element) => element.style.backgroundImage);
  const path = /\/api\/uploads\/[^")]+/.exec(style)?.[0];
  expect(path).toBeTruthy();
  const uploaded = await page.request.get(path ?? '');
  expect(uploaded.status()).toBe(200);

  await openCustomize(page);
  await sheet.getByRole('button', { name: 'Remove image' }).click();
  await sheet.getByRole('button', { name: 'Save', exact: true }).click();
  await page.reload();
  await expect(backdrop).not.toHaveAttribute('style', /\/api\/uploads\//);
});

test('discarding changes reverts the live preview and keeps the saved theme', async ({ page }) => {
  const account = await seedAccount(page);
  await page.goto(profilePath(account));
  const before = (await themeVar(page, '--sotd-bg')).toLowerCase();

  const sheet = await openCustomize(page);
  await sheet.getByText('Midnight CRT', { exact: true }).click();
  await expect.poll(async () => (await themeVar(page, '--sotd-bg')).toLowerCase()).not.toBe(before);

  await page.keyboard.press('Escape');
  const confirm = page.getByRole('alertdialog', { name: 'Discard changes?' });
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: 'Keep editing' }).click();
  expect((await themeVar(page, '--sotd-bg')).toLowerCase()).not.toBe(before);

  await page.keyboard.press('Escape');
  await confirm.getByRole('button', { name: 'Discard' }).click();
  await expect(sheet).toBeHidden();
  await expect.poll(async () => (await themeVar(page, '--sotd-bg')).toLowerCase()).toBe(before);
});
