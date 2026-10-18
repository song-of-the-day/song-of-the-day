import type { Locator, Page } from '@playwright/test';

import { expect, test } from './fixtures';
import { entryDialog, localDate, seedAccount, seedEntry, spokenDate, todayButton } from './helpers';

function logDialog(page: Page): Locator {
  return page.getByRole('dialog', { name: 'log a song' });
}

function card(page: Page, title: string, artist: string, date: string): Locator {
  return page.getByRole('button', { name: `Open ${title} by ${artist}, ${spokenDate(date)}` });
}

/** Saving opens the new entry in a modal dialog; close it to reach the page behind it. */
async function closeEntryDialog(page: Page, date: string): Promise<void> {
  const detail = entryDialog(page, date);
  await expect(detail).toBeVisible();
  await detail.getByRole('button', { name: 'Close' }).click();
  await expect(detail).toBeHidden();
}

async function enterManually(dialog: Locator, title: string, artist: string, length?: string) {
  await dialog.getByRole('button', { name: 'Enter it manually' }).click();
  await dialog.getByLabel('Title').fill(title);
  await dialog.getByLabel('Artist').fill(artist);
  if (length !== undefined) {
    await dialog.getByLabel('Length (optional)').fill(length);
  }
  await dialog.getByRole('button', { name: 'Continue' }).click();
}

test.beforeEach(async ({ page }) => {
  await seedAccount(page);
});

test('search the catalog, pick a song, add a note and see it on the board', async ({ page }) => {
  const today = localDate();
  await page.goto('/profile');
  await todayButton(page).click();

  const dialog = logDialog(page);
  await expect(dialog).toBeVisible();
  await dialog.getByRole('combobox', { name: 'Search for a song' }).fill('jamie colour');
  const results = dialog.getByRole('listbox', { name: 'Search results' });
  await expect(results.getByRole('option')).toHaveCount(2);
  await results.getByRole('option', { name: /Loud Places/ }).click();

  await expect(dialog.getByText('Loud Places')).toBeVisible();
  await dialog.getByLabel('Note (optional)').fill('the steel drums at the drop');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden();

  // The saved song opens in its own dialog (the ?entry=<id> URL).
  const detail = entryDialog(page, today);
  await expect(detail).toBeVisible();
  await expect(detail.getByText('the steel drums at the drop')).toBeVisible();
  await expect(page).toHaveURL(/[?&]entry=\d+/);
  await closeEntryDialog(page, today);

  await expect(card(page, 'Loud Places', 'Jamie xx', today)).toBeVisible();
  await expect(page.getByRole('button', { name: /Today: Loud Places — Jamie xx/ })).toBeVisible();
});

test('a search with no results offers manual entry, which keeps the length', async ({ page }) => {
  const yesterday = localDate(-1);
  await page.goto('/profile');
  await page.getByRole('button', { name: 'Log a day' }).click();

  const dialog = logDialog(page);
  await dialog.getByRole('combobox', { name: 'Search for a song' }).fill('zzzz unknown');
  await expect(dialog.getByText('No matches')).toBeVisible();

  await enterManually(dialog, 'Home Recording', 'Me', '3:45');
  await expect(dialog.getByLabel('Date')).toHaveValue('');
  await dialog.getByLabel('Date').fill(yesterday);
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden();

  const entryId = new URL(page.url()).searchParams.get('entry');
  const response = await page.request.get(`/api/entries/${String(entryId)}`);
  const body = (await response.json()) as { entry: { duration_ms: number; source: string } };
  expect(body.entry).toMatchObject({ duration_ms: 225_000, source: 'manual' });
  await closeEntryDialog(page, yesterday);

  await expect(card(page, 'Home Recording', 'Me', yesterday)).toBeVisible();
});

test('clicking an empty past calendar day logs a song for that date', async ({ page }) => {
  const target = localDate(-2);
  await page.goto('/profile?view=calendar');
  if (target.slice(0, 7) !== localDate().slice(0, 7)) {
    await page.getByRole('button', { name: 'Previous month' }).click();
  }
  await page.getByRole('button', { name: `Log a song for ${spokenDate(target)}` }).click();

  const dialog = logDialog(page);
  await expect(dialog).toBeVisible();
  await enterManually(dialog, 'Calendar Song', 'Day Artist');
  await expect(dialog.getByLabel('Date')).toHaveValue(target);
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden();
  await closeEntryDialog(page, target);

  await expect(card(page, 'Calendar Song', 'Day Artist', target)).toBeVisible();
  await expect(
    page.getByRole('button', { name: `Log a song for ${spokenDate(target)}` }),
  ).toHaveCount(0);
});

test('logging a taken date offers to open the existing entry', async ({ page }) => {
  const date = localDate(-3);
  await seedEntry(page, { title: 'Already Here', artist: 'First', entry_date: date });
  await page.goto('/profile');
  await page.getByRole('button', { name: 'Log a day' }).click();

  const dialog = logDialog(page);
  await enterManually(dialog, 'Second Try', 'Second');
  await dialog.getByLabel('Date').fill(date);
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();

  const conflict = dialog.getByRole('alert').filter({ hasText: 'You already logged' });
  await expect(conflict).toContainText('Already Here');
  await conflict.getByRole('button', { name: 'Open it' }).click();

  await expect(dialog).toBeHidden();
  await expect(entryDialog(page, date)).toBeVisible();
});

test('logging a taken date can replace the existing song', async ({ page }) => {
  const date = localDate(-4);
  await seedEntry(page, {
    title: 'Old Song',
    artist: 'Old Artist',
    entry_date: date,
    note: 'keep this note',
  });
  await page.goto('/profile');
  await expect(card(page, 'Old Song', 'Old Artist', date)).toBeVisible();
  await page.getByRole('button', { name: 'Log a day' }).click();

  const dialog = logDialog(page);
  await dialog.getByRole('combobox', { name: 'Search for a song' }).fill('teardrop');
  await dialog.getByRole('option', { name: /Teardrop/ }).click();
  await dialog.getByLabel('Date').fill(date);
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();

  await dialog.getByRole('button', { name: 'Replace it' }).click();
  await expect(dialog).toBeHidden();
  await closeEntryDialog(page, date);

  await expect(card(page, 'Teardrop', 'Massive Attack', date)).toBeVisible();
  await expect(card(page, 'Old Song', 'Old Artist', date)).toHaveCount(0);

  await card(page, 'Teardrop', 'Massive Attack', date).click();
  await expect(entryDialog(page, date).getByText('keep this note')).toBeVisible();
});

test('an entry can be edited and deleted in place', async ({ page }) => {
  const date = localDate(-5);
  const entry = await seedEntry(page, { title: 'Edit Me', artist: 'Someone', entry_date: date });
  await page.goto(`/profile?entry=${String(entry.id)}`);

  let detail = entryDialog(page, date);
  // Edit mode replaces the window's own body in place: no second dialog opens.
  await detail.getByRole('button', { name: 'Edit', exact: true }).click();
  await detail.getByLabel('Note (optional)').fill('now with a note');
  await detail.getByRole('button', { name: 'Save', exact: true }).click();
  // The window returns to view mode once the save lands (the note text would also match the
  // textarea while still editing, so wait for the edit form to go away first).
  await expect(detail.getByRole('button', { name: 'Edit', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await expect(detail.getByText('now with a note')).toBeVisible();

  await page.reload();
  detail = entryDialog(page, date);
  await expect(detail.getByText('now with a note')).toBeVisible();

  await detail.getByRole('button', { name: 'Edit', exact: true }).click();
  await detail.getByRole('button', { name: 'Delete entry' }).click();
  const confirm = page.getByRole('alertdialog', { name: 'Delete entry' });
  await expect(confirm).toContainText("Delete this day's song?");
  await confirm.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(detail).toBeHidden();
  await expect(page).not.toHaveURL(/entry=/);
  await expect(card(page, 'Edit Me', 'Someone', date)).toHaveCount(0);
  // Back on the empty board, the journal is empty again.
  await page.getByText('Board', { exact: true }).click();
  await expect(page.getByRole('heading', { name: 'no songs yet' })).toBeVisible();
});
