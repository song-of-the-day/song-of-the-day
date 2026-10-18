import { ChevronDown, Palette, UserRound } from 'lucide-react';

import { Button } from '@/components/ui/Button';

export interface ProfileDockActions {
  onCustomize: () => void;
  onAccount: () => void;
}

/**
 * The owner's floating controls: a small bar that hovers at the bottom of the
 * page with [Customize] and [Account]. Shown only in owner mode; visitors never see it. It stays
 * mounted while the sheets it opens are open (so focus returns to the trigger on close); a modal's
 * overlay covers it meanwhile. The outer bar lets pointer events fall through to the page so only
 * the panel itself is clickable.
 */
export function ProfileDock({ onCustomize, onAccount }: ProfileDockActions) {
  return (
    <footer
      aria-label="Settings"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
    >
      <div className="y2k-window pointer-events-auto flex items-center gap-2 p-2 motion-safe:animate-pop-in">
        <Button
          variant="secondary"
          size="sm"
          aria-haspopup="dialog"
          icon={<Palette aria-hidden="true" className="size-4" />}
          onClick={onCustomize}
        >
          Customize
        </Button>
        <Button
          variant="secondary"
          size="sm"
          aria-haspopup="dialog"
          icon={<UserRound aria-hidden="true" className="size-4" />}
          onClick={onAccount}
        >
          Account
          <ChevronDown aria-hidden="true" className="-mr-1 size-4" />
        </Button>
      </div>
    </footer>
  );
}
