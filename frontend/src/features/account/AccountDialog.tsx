import { LogOut } from 'lucide-react';
import { useNavigate } from 'react-router';

import { useLogout, useMe } from '@/api/hooks/auth';
import { describeApiError } from '@/api/messages';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { useToast } from '@/components/ui/useToast';

import { ChangePasswordForm } from './ChangePasswordForm';
import { DIALOG_TITLE, LOGGED_OUT_MESSAGE } from './copy';
import { DeleteAccountForm } from './DeleteAccountForm';
import { ExportDataSection } from './ExportDataSection';
import { PlaybackSection } from './PlaybackSection';
import { UsernameSection } from './UsernameSection';

export interface AccountDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Account settings: change the username, change the password, playback
 * (auto-play previews), export data and, in a danger zone, delete the account. Log out sits in the
 * footer, always in reach.
 */
export function AccountDialog({ open, onOpenChange }: AccountDialogProps): React.JSX.Element {
  const { data: user } = useMe();
  const toast = useToast();
  const navigate = useNavigate();
  const logout = useLogout();

  async function handleLogout() {
    try {
      // Awaited rather than a mutate callback: ending the session unmounts this dialog.
      await logout.mutateAsync();
    } catch (error) {
      toast.show(describeApiError(error), { tone: 'error' });
      return;
    }
    toast.show(LOGGED_OUT_MESSAGE);
    await navigate('/login', { replace: true });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={DIALOG_TITLE}
      description={user === undefined || user === null ? undefined : `Logged in as ${user.email}`}
      footer={
        <Button
          variant="secondary"
          loading={logout.isPending}
          icon={<LogOut aria-hidden="true" className="size-4" />}
          onClick={() => {
            void handleLogout();
          }}
        >
          Log out
        </Button>
      }
    >
      <div className="flex flex-col gap-6">
        <UsernameSection />
        <ChangePasswordForm />
        <PlaybackSection />
        <ExportDataSection />
        <DeleteAccountForm />
      </div>
    </Dialog>
  );
}
