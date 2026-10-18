/**
 * Mutation hooks for the owner's entries. Each one puts the returned
 * `EntryDetail` into `['users', me.username, 'entry', id]` and invalidates the owner's
 * `['users', me.username, 'entries', …]` lists. Reads live in `users.ts`.
 */
import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';

import { createEntry, deleteEntry, updateEntry } from '../entries';
import { queryKeys } from '../keys';
import type { EntryDetail, EntryPatch } from '../types';
import { ownerEntriesKey, ownerUsername } from './owner';

async function entrySaved(queryClient: QueryClient, entry: EntryDetail): Promise<void> {
  const username = ownerUsername(queryClient);
  if (username !== null) {
    queryClient.setQueryData(queryKeys.entry(username, entry.id), entry);
  }
  await queryClient.invalidateQueries({ queryKey: ownerEntriesKey(queryClient) });
}

/** Logs a song for a day. A `409 entry_exists` error carries the existing entry's id. */
export function useCreateEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createEntry,
    onSuccess: (entry) => entrySaved(queryClient, entry),
  });
}

/** Variables of {@link useUpdateEntry}. */
export interface UpdateEntryVariables {
  id: number;
  patch: EntryPatch;
}

/** Updates an entry with a PATCH of the changed fields. */
export function useUpdateEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: UpdateEntryVariables) => updateEntry(id, patch),
    onSuccess: (entry) => entrySaved(queryClient, entry),
  });
}

/** Deletes an entry (by id) and its annotations. */
export function useDeleteEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteEntry,
    onSuccess: async (_data, id) => {
      const username = ownerUsername(queryClient);
      if (username !== null) {
        queryClient.removeQueries({ queryKey: queryKeys.entry(username, id), exact: true });
      }
      await queryClient.invalidateQueries({ queryKey: ownerEntriesKey(queryClient) });
    },
  });
}
