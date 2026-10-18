/**
 * The owner's entry write endpoints. Reads go through the public profile endpoints (`users.ts`).
 */
import { apiJson, apiVoid } from './client';
import type { EntryCreateInput, EntryDetail, EntryPatch } from './types';

interface EntryEnvelope {
  entry: EntryDetail;
}

/**
 * Logs a song for a day (`POST /api/entries`).
 *
 * @param input - The entry fields.
 * @returns The created entry (with no annotations).
 * @throws ApiError `409 entry_exists` (with `details.existing_entry_id`) when the day is taken.
 */
export async function createEntry(input: EntryCreateInput): Promise<EntryDetail> {
  const body = await apiJson('/entries', { method: 'POST', body: input });
  return (body as EntryEnvelope).entry;
}

/**
 * Updates an entry (`PATCH /api/entries/<id>`).
 *
 * @param id - The entry id.
 * @param patch - The fields to change; `null` clears optional fields.
 * @returns The updated entry.
 */
export async function updateEntry(id: number, patch: EntryPatch): Promise<EntryDetail> {
  const body = await apiJson(`/entries/${String(id)}`, { method: 'PATCH', body: patch });
  return (body as EntryEnvelope).entry;
}

/**
 * Deletes an entry and its annotations (`DELETE /api/entries/<id>`).
 *
 * @param id - The entry id.
 */
export async function deleteEntry(id: number): Promise<void> {
  await apiVoid(`/entries/${String(id)}`, { method: 'DELETE' });
}
