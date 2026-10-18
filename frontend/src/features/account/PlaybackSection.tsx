import { useMe } from '@/api/hooks/auth';
import { useSetAutoplayPreviews } from '@/api/hooks/profile';
import { describeApiError } from '@/api/messages';
import { Switch } from '@/components/ui/Switch';
import { useToast } from '@/components/ui/useToast';

import { AccountSection } from './AccountSection';
import { AUTOPLAY_HINT, AUTOPLAY_LABEL, AUTOPLAY_SAVE_FAILED } from './copy';

/**
 * "Playback": the auto-play previews switch. It saves immediately; the
 * switch flips at once and flips back, with an error toast, if saving fails.
 */
export function PlaybackSection() {
  const toast = useToast();
  const { data: user } = useMe();
  const setAutoplay = useSetAutoplayPreviews();

  return (
    <AccountSection title="Playback">
      <Switch
        label={AUTOPLAY_LABEL}
        hint={AUTOPLAY_HINT}
        checked={user?.autoplay_previews ?? true}
        onCheckedChange={(enabled) => {
          setAutoplay.mutate(enabled, {
            onError: (error) => {
              toast.show(`${AUTOPLAY_SAVE_FAILED} ${describeApiError(error)}`, { tone: 'error' });
            },
          });
        }}
      />
    </AccountSection>
  );
}
