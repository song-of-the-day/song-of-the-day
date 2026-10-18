import * as RadixDialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';

import { useMediaQuery, WIDE_VIEWPORT_QUERY } from '@/hooks/useMediaQuery';
import { cn } from '@/lib/cn';

import { IconButton } from './IconButton';
import { useReturnFocus } from './useReturnFocus';
import { WindowTitleBar } from './Window';

type ContentProps = ComponentPropsWithoutRef<typeof RadixDialog.Content>;

export interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  /** Actions pinned to the bottom of the panel, e.g. Cancel / Save. */
  footer?: ReactNode;
  /**
   * Whether the side panel (≥ 640px) is modal, with a dimming overlay and a focus trap (default
   * `true`). Below 640px the sheet is always a non-modal bottom sheet without an overlay, so the
   * page above stays visible and scrollable.
   */
  modal?: boolean;
  /**
   * What covers the page while the modal side panel is open: a dimming scrim (default) or
   * nothing, for panels whose whole point is the live page preview behind them. Outside clicks
   * and Esc still close (or reach `onInteractOutside` / `onEscapeKeyDown`) either way.
   */
  overlay?: 'dim' | 'none';
  closeLabel?: string;
  /** Called on Esc; call `event.preventDefault()` to keep the sheet open (e.g. to confirm). */
  onEscapeKeyDown?: ContentProps['onEscapeKeyDown'];
  /**
   * Called on a pointer down or focus outside the sheet; call `event.preventDefault()` to keep it
   * open. Interactions outside a non-modal sheet never close it, because the page stays usable
   * while it is open.
   */
  onInteractOutside?: ContentProps['onInteractOutside'];
  onOpenAutoFocus?: ContentProps['onOpenAutoFocus'];
  onCloseAutoFocus?: ContentProps['onCloseAutoFocus'];
  className?: string;
  bodyClassName?: string;
}

/**
 * A panel for editing alongside the page: a 360px right-side panel at
 * ≥ 640px and a bottom sheet (max 55vh) below. Built on Radix Dialog; closing through ✕ calls
 * `onOpenChange(false)` like Esc and outside clicks, so a caller can intercept every way out.
 */
export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  modal = true,
  overlay = 'dim',
  closeLabel = 'Close',
  onEscapeKeyDown,
  onInteractOutside,
  onOpenAutoFocus,
  onCloseAutoFocus,
  className,
  bodyClassName,
}: SheetProps) {
  const wide = useMediaQuery(WIDE_VIEWPORT_QUERY);
  const isModal = wide && modal;
  const hasDescription = description !== undefined && description !== null;
  const returnFocus = useReturnFocus(onOpenAutoFocus, onCloseAutoFocus);

  function handleInteractOutside(event: Parameters<NonNullable<typeof onInteractOutside>>[0]) {
    onInteractOutside?.(event);
    if (!isModal) {
      event.preventDefault();
    }
  }

  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange} modal={isModal}>
      <RadixDialog.Portal>
        {isModal && overlay === 'dim' && (
          <RadixDialog.Overlay className="fixed inset-0 z-40 bg-fg/30 motion-safe:animate-fade-in" />
        )}
        <RadixDialog.Content
          onEscapeKeyDown={onEscapeKeyDown}
          onInteractOutside={handleInteractOutside}
          onOpenAutoFocus={returnFocus.onOpenAutoFocus}
          onCloseAutoFocus={returnFocus.onCloseAutoFocus}
          {...(hasDescription ? {} : { 'aria-describedby': undefined })}
          data-layout={wide ? 'side' : 'bottom'}
          className={cn(
            'y2k-window fixed z-50 flex flex-col outline-none motion-safe:animate-pop-in',
            'inset-x-0 bottom-0 max-h-[55vh] border-x-0 border-b-0 shadow-[0_-2px_0_var(--sotd-border)]',
            'sm:inset-x-auto sm:top-0 sm:right-0 sm:h-dvh sm:max-h-none sm:w-[360px] sm:border-y-0 sm:border-r-0 sm:border-l sm:shadow-[-2px_0_0_var(--sotd-border)]',
            className,
          )}
        >
          <WindowTitleBar
            actions={
              <RadixDialog.Close asChild>
                <IconButton label={closeLabel} size="sm">
                  <X className="size-4" />
                </IconButton>
              </RadixDialog.Close>
            }
          >
            <RadixDialog.Title className="truncate">{title}</RadixDialog.Title>
          </WindowTitleBar>
          <div
            className={cn(
              'min-h-0 flex-1 overflow-y-auto overscroll-contain',
              bodyClassName ?? 'p-4',
            )}
          >
            {hasDescription && (
              <RadixDialog.Description className="mb-4 text-sm text-muted">
                {description}
              </RadixDialog.Description>
            )}
            {children}
          </div>
          {footer !== undefined && (
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-line px-4 py-3">
              {footer}
            </div>
          )}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
