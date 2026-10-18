import { randomUUID } from 'node:crypto';

import { expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';

/** The time zone every spec's browser runs in (playwright.config.ts). */
const TIME_ZONE = 'America/Toronto';

export const PASSWORD = 'correct horse battery staple';

export interface Account {
  email: string;
  password: string;
  /** The signup username; the display name starts as this too. */
  username: string;
}

/** A fresh account identity; the e2e database is shared by every spec. */
export function newAccount(): Account {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 8);
  return {
    email: `e2e-${suffix}@example.com`,
    password: PASSWORD,
    username: `e2e-${suffix}`,
  };
}

/** The account's profile path (`/<username>`). */
export function profilePath(account: Account): string {
  return `/${account.username}`;
}

/**
 * The toolbar's primary button ("Log today's song", or "Today: <song>" once today is logged).
 * On an empty board the empty state repeats "Log today's song"; the toolbar one comes first.
 */
export function todayButton(page: Page): Locator {
  return page.getByRole('button', { name: /^(?:Log today's song|Today: )/ }).first();
}

/**
 * Returns the browser's local date (`yyyy-MM-dd`) shifted by `offsetDays`.
 *
 * Uses noon UTC as the anchor so adding days never crosses a DST edge into the wrong date.
 */
export function localDate(offsetDays = 0): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(new Date());
  const anchor = new Date(`${today}T12:00:00Z`);
  anchor.setUTCDate(anchor.getUTCDate() + offsetDays);
  return anchor.toISOString().slice(0, 10);
}

/** Formats a `yyyy-MM-dd` date like the app's accessible labels ("Wednesday, October 14, 2026"). */
export function spokenDate(date: string): string {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00Z`));
}

/** Formats a `yyyy-MM-dd` date like the entry dialog's title ("Wed, Oct 14"). */
export function displayDate(date: string): string {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00Z`));
}

/** The open entry dialog, whose accessible name is the entry's short display date. */
export function entryDialog(page: Page, date: string): Locator {
  return page.getByRole('dialog', { name: displayDate(date) });
}

async function csrfToken(request: APIRequestContext): Promise<string> {
  const response = await request.get('/api/auth/csrf');
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as { csrf_token: string };
  return body.csrf_token;
}

/** Calls an unsafe API endpoint with the CSRF header, sharing the page's session cookie. */
export async function apiCall<T>(
  page: Page,
  method: 'POST' | 'PATCH' | 'DELETE',
  path: string,
  data?: unknown,
): Promise<T> {
  const token = await csrfToken(page.request);
  const response = await page.request.fetch(path, {
    method,
    headers: { 'X-CSRFToken': token },
    ...(data === undefined ? {} : { data }),
  });
  expect(response.ok(), `${method} ${path} → ${String(response.status())}`).toBe(true);
  return (response.status() === 204 ? undefined : await response.json()) as T;
}

/** Signs up through the API (the browser context is then logged in) and returns the account. */
export async function seedAccount(page: Page, account: Account = newAccount()): Promise<Account> {
  await apiCall(page, 'POST', '/api/auth/signup', {
    email: account.email,
    password: account.password,
    username: account.username,
  });
  return account;
}

/** Signs up through the UI's form and lands on the new profile. */
export async function signUpThroughUi(page: Page, account: Account): Promise<void> {
  await page.goto('/signup');
  await page.getByLabel('Username').fill(account.username);
  await page.getByLabel('Email').fill(account.email);
  await page.getByLabel('Password', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
}

export interface SeededEntry {
  id: number;
  title: string;
  artist: string;
  entry_date: string;
}

/** Logs a manual song through the API. */
export async function seedEntry(
  page: Page,
  fields: { title: string; artist: string; entry_date: string } & Record<string, unknown>,
): Promise<SeededEntry> {
  const body = await apiCall<{ entry: SeededEntry }>(page, 'POST', '/api/entries', {
    source: 'manual',
    ...fields,
  });
  return body.entry;
}

/**
 * Logs a song that looks like one picked from the iTunes search: with artwork, a playable
 * preview (both served by the network stubs) and the given duration.
 */
export async function seedItunesEntry(
  page: Page,
  fields: {
    trackId: number;
    title: string;
    artist: string;
    entry_date: string;
  } & Record<string, unknown>,
): Promise<SeededEntry> {
  const { trackId, ...rest } = fields;
  return seedEntry(page, {
    source: 'itunes',
    source_id: String(trackId),
    artwork_url: `https://is1-ssl.mzstatic.com/image/thumb/Music/v4/${String(trackId)}/100x100bb.jpg`,
    preview_url: `https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview/${String(trackId)}.m4a`,
    duration_ms: 225_000,
    ...rest,
  });
}

/** Fills and submits the login form. */
export async function logIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Log in' }).click();
}

/** Opens the account dialog from the profile's footer dock. */
export async function openAccount(page: Page) {
  await page.getByRole('button', { name: 'Account' }).click();
  const dialog = page.getByRole('dialog', { name: 'account' });
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Opens the customize sheet from the profile's footer dock. */
export async function openCustomize(page: Page) {
  await page.getByRole('button', { name: 'Customize' }).click();
  const sheet = page.getByRole('dialog', { name: 'customize' });
  await expect(sheet).toBeVisible();
  return sheet;
}

/** The current value of a theme CSS variable on the document root. */
export async function themeVar(page: Page, name: string): Promise<string> {
  return page.evaluate(
    (variable) => getComputedStyle(document.documentElement).getPropertyValue(variable).trim(),
    name,
  );
}
