import { Share } from 'lucide-react';
import { useRef, useState } from 'react';

import type { PublicProfile } from '@/api/types';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { APP_NAME } from '@/components/ui/DocumentTitle';
import { TextField } from '@/components/ui/TextField';
import { useToast } from '@/components/ui/useToast';
import { profileUrl } from '@/lib/username';

import { profileTitle } from './profileTitle';

export const LINK_COPIED_MESSAGE = 'Link copied';

export interface ShareButtonProps {
  /** The owner's profile, whose URL is shared. */
  profile: Pick<PublicProfile, 'display_name' | 'username'>;
}

/** Whether a rejected `navigator.share` means the user dismissed the share sheet. */
function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

/**
 * [Share]: opens the system share sheet for `${location.origin}/<username>`
 * where the Web Share API exists; elsewhere, or when sharing fails for any reason other than the
 * user dismissing the sheet, it copies the link and confirms with a toast. Where the clipboard
 * isn't available (or refuses), it shows the link in a selectable field instead. Sharing this URL
 * is the app's only social feature.
 */
export function ShareButton({ profile }: ShareButtonProps) {
  const toast = useToast();
  const [fallbackOpen, setFallbackOpen] = useState(false);
  const fieldRef = useRef<HTMLInputElement>(null);
  const url = profileUrl(profile.username);

  async function copy() {
    try {
      // `clipboard` is missing outside secure contexts, despite what the DOM types say.
      const clipboard = navigator.clipboard as Clipboard | undefined;
      if (clipboard === undefined) {
        throw new Error('Clipboard unavailable');
      }
      await clipboard.writeText(url);
    } catch {
      setFallbackOpen(true);
      return;
    }
    toast.show(LINK_COPIED_MESSAGE, { tone: 'success' });
  }

  async function share() {
    // Most desktop browsers have no Web Share API, despite what the DOM types say.
    if ('share' in navigator) {
      try {
        await navigator.share({ title: `${profileTitle(profile)} · ${APP_NAME}`, url });
        return;
      } catch (error) {
        if (isAbortError(error)) {
          return;
        }
      }
    }
    await copy();
  }

  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        icon={<Share aria-hidden="true" className="size-4" />}
        onClick={() => {
          void share();
        }}
      >
        Share
      </Button>
      <Dialog
        open={fallbackOpen}
        onOpenChange={setFallbackOpen}
        title="your link"
        description="Copy this link to share your page. Anyone with it can see your songs."
        size="sm"
        onOpenAutoFocus={(event) => {
          // Land on the link, selected, so one copy shortcut takes it all.
          event.preventDefault();
          fieldRef.current?.focus();
        }}
      >
        <TextField
          ref={fieldRef}
          label="Profile link"
          readOnly
          value={url}
          onFocus={(event) => {
            event.target.select();
          }}
        />
      </Dialog>
    </>
  );
}
