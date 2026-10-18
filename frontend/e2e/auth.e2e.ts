import { expect, test } from './fixtures';
import {
  logIn,
  newAccount,
  openAccount,
  profilePath,
  seedAccount,
  signUpThroughUi,
} from './helpers';

test('signing up lands on the new profile, and logging out and back in works', async ({ page }) => {
  const account = newAccount();
  await signUpThroughUi(page, account);

  await expect(page).toHaveURL(new RegExp(`${profilePath(account)}$`));
  // The display name starts as the username.
  await expect(page.getByRole('heading', { level: 1, name: account.username })).toBeVisible();
  // The default theme's default view is the Calendar.
  await expect(page.getByRole('radio', { name: 'Calendar' })).toBeChecked();

  const dialog = await openAccount(page);
  await dialog.getByRole('button', { name: 'Log out' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByText('You are logged out. See you tomorrow ✦')).toBeVisible();

  // /profile redirects a logged-out visitor to /login and comes back afterwards.
  await page.goto('/profile');
  await expect(page).toHaveURL(/\/login/);

  await logIn(page, account.email, account.password);
  await expect(page).toHaveURL(new RegExp(`${profilePath(account)}$`));
  await expect(page.getByRole('heading', { level: 1, name: account.username })).toBeVisible();
});

test('/profile redirects a logged-in user to their own page', async ({ page }) => {
  const account = await seedAccount(page);
  await page.goto('/profile');
  await expect(page).toHaveURL(new RegExp(`${profilePath(account)}$`));
});

test('a reserved username is refused inline before any API call', async ({ page }) => {
  const account = newAccount();
  await page.goto('/signup');
  // "profile" is a reserved top-level route in shared/usernames.json.
  await page.getByLabel('Username').fill('profile');
  await page.getByLabel('Email').fill(account.email);
  await page.getByLabel('Password', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Create account', exact: true }).click();

  await expect(page.getByText('Username profile is unavailable.')).toBeVisible();
  await expect(page).toHaveURL(/\/signup$/);
});

test('a taken username shows an inline error', async ({ page }) => {
  const existing = await seedAccount(page);
  await page.context().clearCookies();

  const account = newAccount();
  await page.goto('/signup');
  await page.getByLabel('Username').fill(existing.username);
  await page.getByLabel('Email').fill(account.email);
  await page.getByLabel('Password', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Create account', exact: true }).click();

  await expect(page.getByText(`Username ${existing.username} is already taken.`)).toBeVisible();
  await expect(page).toHaveURL(/\/signup$/);
});

test('a wrong password shows an inline error and stays on the login page', async ({ page }) => {
  const account = await seedAccount(page);
  await page.context().clearCookies();

  await logIn(page, account.email, 'not the right password');
  await expect(page.getByText('Incorrect email or password.')).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByLabel('Email')).toHaveValue(account.email);
});

test('an unauthenticated visit to /profile or / redirects to /login', async ({ page }) => {
  await page.goto('/profile');
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole('button', { name: 'Log in', exact: true })).toBeVisible();

  await page.goto('/');
  await expect(page).toHaveURL(/\/login/);
});

test('an unknown route shows the not-found page', async ({ page }) => {
  // A single unknown segment is a profile lookup ("nobody's here"); deeper paths 404.
  const response = await page.goto('/no/such/page');
  expect(response?.status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('page not found');
});
