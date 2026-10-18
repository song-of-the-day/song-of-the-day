/**
 * Mutation hooks for account management.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { saveBlob } from '@/lib/download';

import { changePassword, deleteAccount, exportData } from '../account';
import { endSession } from './session';

/** Changes the password; the current session stays valid. */
export function useChangePassword() {
  return useMutation({ mutationFn: changePassword });
}

/** Deletes the account; on success `['me']` becomes `null` and every other cache is dropped. */
export function useDeleteAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteAccount,
    onSuccess: () => {
      endSession(queryClient);
    },
  });
}

/** Downloads the data export and hands it to the browser as a file download. */
export function useExportData() {
  return useMutation({
    mutationFn: async () => {
      const file = await exportData();
      saveBlob(file.blob, file.filename);
      return file;
    },
  });
}
