import { expect, test } from './fixtures';
import { logIn, openAccount, profilePath, seedAccount } from './helpers';

const NEW_PASSWORD = 'a brand new horse battery staple';

test('changing the password keeps this session and the new one works after re-login', async ({
  page,
}) => {
  const account = await seedAccount(page);
  await page.goto(profilePath(account));
  const dialog = await openAccount(page);

  await dialog.getByLabel('Current password').fill(account.password);
  await dialog.getByLabel('New password', { exact: true }).fill(NEW_PASSWORD);
  await dialog.getByLabel('Confirm new password').fill(NEW_PASSWORD);
  await dialog.getByRole('button', { name: 'Change password' }).click();
  await expect(
    page.getByText('Password changed. Your other devices were logged out.'),
  ).toBeVisible();

  await dialog.getByRole('button', { name: 'Log out' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await logIn(page, account.email, NEW_PASSWORD);
  await expect(page).toHaveURL(new RegExp(`${profilePath(account)}$`));
});

test('closing the account dialog returns focus to the dock button that opened it', async ({
  page,
}) => {
  const account = await seedAccount(page);
  await page.goto(profilePath(account));
  const dialog = await openAccount(page);

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  // The footer dock stays mounted while the dialog is open, so focus returns to [Account].
  await expect(page.getByRole('button', { name: 'Account' })).toBeFocused();
});

test('changing the username moves the profile to its new link', async ({ page }) => {
  const account = await seedAccount(page);
  await page.goto(profilePath(account));
  const dialog = await openAccount(page);

  const newUsername = `${account.username}-renamed`;
  // The "Username" section itself is labelled "Username" too, so target the textbox by role.
  await dialog.getByRole('textbox', { name: 'Username' }).fill(newUsername);
  await dialog.getByRole('button', { name: 'Change username' }).click();

  await expect(page.getByText('Your username is changed ✦')).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/${newUsername}$`));
});

test('downloading the journal saves a dated JSON file', async ({ page }) => {
  const account = await seedAccount(page);
  await page.goto(profilePath(account));
  const dialog = await openAccount(page);

  const downloadPromise = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download my data' }).click();
  const download = await downloadPromise;
  const utcToday = new Date().toISOString().slice(0, 10);
  expect(download.suggestedFilename()).toBe(`sotd-export-${utcToday}.json`);
  await expect(page.getByText('Your journal is downloading.')).toBeVisible();
});

test('deleting the account ends the session and the credentials stop working', async ({ page }) => {
  const account = await seedAccount(page);
  await page.goto(profilePath(account));
  const dialog = await openAccount(page);

  await dialog.getByLabel('Your password').fill(account.password);
  await dialog.getByLabel(/Type delete my journal to confirm/).fill('delete my journal');
  await dialog.getByRole('button', { name: 'Delete my account' }).click();

  await expect(page.getByText('Your account and journal were deleted.')).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
  await logIn(page, account.email, account.password);
  await expect(page.getByText('Incorrect email or password.')).toBeVisible();
});
