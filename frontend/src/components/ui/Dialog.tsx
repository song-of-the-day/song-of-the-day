import * as RadixDialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';

import { cn } from '@/lib/cn';

import { IconButton } from './IconButton';
import { useReturnFocus } from './useReturnFocus';
import { WindowTitleBar } from './Window';

type ContentProps = ComponentPropsWithoutRef<typeof RadixDialog.Content>;

export type DialogSize = 'sm' | 'md' | 'lg';

const SIZES: Record<DialogSize, string> = {
  sm: 'sm:max-w-sm',
  md: 'sm:max-w-lg',
  lg: 'sm:max-w-2xl',
};

/** Fills the screen below 640px; a centered panel above. */
const FULL_SCREEN_ON_MOBILE =
  'inset-0 h-dvh w-full sm:inset-auto sm:top-1/2 sm:left-1/2 sm:h-auto sm:max-h-[min(85dvh,48rem)] sm:w-[calc(100%-2rem)] sm:-translate-x-1/2 sm:-translate-y-1/2';
/** A centered panel at every width. */
const CENTERED =
  'top-1/2 left-1/2 max-h-[85dvh] w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 sm:max-h-[min(85dvh,48rem)]';

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Shown in the title bar (heading font) and used as the dialog's accessible name. */
  title: ReactNode;
  /** A short description under the title bar, used as the accessible description. */
  description?: ReactNode;
  children?: ReactNode;
  /** Actions pinned below the scrolling body, e.g. Cancel / Save. */
  footer?: ReactNode;
  /** Maximum width at ≥ 640px (default `md`). */
  size?: DialogSize;
  /** Fill the screen below 640px (default `true`); otherwise stay a centered panel. */
  fullScreenOnMobile?: boolean;
  /** `alertdialog` for confirmations that interrupt the user. */
  role?: 'dialog' | 'alertdialog';
  /** Hide the ✕ button (the dialog must then offer its own way out). */
  hideCloseButton?: boolean;
  closeLabel?: string;
  onEscapeKeyDown?: ContentProps['onEscapeKeyDown'];
  onInteractOutside?: ContentProps['onInteractOutside'];
  onOpenAutoFocus?: ContentProps['onOpenAutoFocus'];
  onCloseAutoFocus?: ContentProps['onCloseAutoFocus'];
  className?: string;
  /** Classes for the scrolling body; they replace the default padding. */
  bodyClassName?: string;
}

/**
 * A modal dialog styled as a Y2K window (Radix Dialog: focus trap, Esc, outside click, focus
 * return). Below 640px it fills the screen unless `fullScreenOnMobile` is false. It is portaled to
 * `<body>`, where the theme variables on `<html>` still apply.
 */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = 'md',
  fullScreenOnMobile = true,
  role = 'dialog',
  hideCloseButton = false,
  closeLabel = 'Close',
  onEscapeKeyDown,
  onInteractOutside,
  onOpenAutoFocus,
  onCloseAutoFocus,
  className,
  bodyClassName,
}: DialogProps) {
  const hasDescription = description !== undefined && description !== null;
  const returnFocus = useReturnFocus(onOpenAutoFocus, onCloseAutoFocus);
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-fg/40 motion-safe:animate-fade-in" />
        <RadixDialog.Content
          role={role}
          onEscapeKeyDown={onEscapeKeyDown}
          onInteractOutside={onInteractOutside}
          onOpenAutoFocus={returnFocus.onOpenAutoFocus}
          onCloseAutoFocus={returnFocus.onCloseAutoFocus}
          // Radix links the description itself; without one, opt out of its dev warning.
          {...(hasDescription ? {} : { 'aria-describedby': undefined })}
          className={cn(
            'y2k-window fixed z-50 flex flex-col outline-none motion-safe:animate-pop-in',
            fullScreenOnMobile ? FULL_SCREEN_ON_MOBILE : CENTERED,
            SIZES[size],
            className,
          )}
        >
          <WindowTitleBar
            actions={
              hideCloseButton ? undefined : (
                <RadixDialog.Close asChild>
                  <IconButton label={closeLabel} size="sm">
                    <X className="size-4" />
                  </IconButton>
                </RadixDialog.Close>
              )
            }
          >
            <RadixDialog.Title className="truncate">{title}</RadixDialog.Title>
          </WindowTitleBar>
          <div className={cn('min-h-0 flex-1 overflow-y-auto', bodyClassName ?? 'p-4 sm:p-6')}>
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
