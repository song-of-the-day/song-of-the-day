import { expect, test } from './fixtures';
import {
  entryDialog,
  localDate,
  profilePath,
  seedAccount,
  seedEntry,
  seedItunesEntry,
} from './helpers';

test('pin a note at the playhead, then edit and delete it', async ({ page }) => {
  const account = await seedAccount(page);
  const today = localDate();
  const entry = await seedItunesEntry(page, {
    trackId: 1001,
    title: 'Gosh',
    artist: 'Jamie xx',
    entry_date: today,
    youtube_video_id: 'abcdefghijk',
  });
  await page.goto(`${profilePath(account)}?entry=${String(entry.id)}`);
  const detail = entryDialog(page, today);

  // Notes are made in the dialog's edit mode.
  await detail.getByRole('button', { name: 'Edit', exact: true }).click();
  await detail.getByRole('button', { name: /^Note at / }).click();
  const form = detail.getByRole('form', { name: 'New note' });
  await form.getByLabel('Note').fill('the steel drums at the drop');
  await form.getByRole('button', { name: 'Add note' }).click();

  const list = detail.getByRole('list', { name: 'Notes' });
  await expect(list.getByText('the steel drums at the drop')).toBeVisible();
  await expect(
    detail
      .getByRole('toolbar', { name: 'Notes on the timeline' })
      .getByRole('button', { name: /the steel drums/ }),
  ).toBeVisible();

  await list.getByRole('button', { name: /^Edit note at / }).click();
  const editForm = detail.getByRole('form', { name: 'Edit note' });
  await editForm.getByLabel('Note').fill('the steel drums, again');
  await editForm.getByRole('button', { name: 'Save note' }).click();
  await expect(list.getByText('the steel drums, again')).toBeVisible();

  await list.getByRole('button', { name: /^Delete note at / }).click();
  const confirm = page.getByRole('alertdialog', { name: 'Delete note' });
  await confirm.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(detail.getByText('No notes yet. Pin a thought to a moment you love.')).toBeVisible();
});

test('add a note by typing times on an entry without a video', async ({ page }) => {
  const account = await seedAccount(page);
  const today = localDate();
  const entry = await seedEntry(page, { title: 'Basement Tape', artist: 'Me', entry_date: today });
  await page.goto(`${profilePath(account)}?entry=${String(entry.id)}`);
  const detail = entryDialog(page, today);

  await detail.getByRole('button', { name: 'Edit', exact: true }).click();
  await detail.getByRole('button', { name: 'Add a note' }).click();
  const form = detail.getByRole('form', { name: 'New note' });
  await form.getByLabel('Start').fill('0:10');
  await form.getByLabel('End (optional)').fill('0:30');
  await form.getByLabel('Note').fill('the intro');
  await form.getByRole('button', { name: 'Add note' }).click();

  const list = detail.getByRole('list', { name: 'Notes' });
  await expect(list.getByText('the intro')).toBeVisible();
  await expect(list.getByRole('button', { name: /^Edit note at 0:10/ })).toBeVisible();
});
