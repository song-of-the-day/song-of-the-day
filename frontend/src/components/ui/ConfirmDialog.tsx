import * as RadixDialog from '@radix-ui/react-dialog';
import { useRef, type ReactNode } from 'react';

import { FormError } from './Alert';
import { Button } from './Button';
import { Dialog } from './Dialog';

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  /** What will happen, e.g. "Delete this day's song and its 3 notes?". */
  message?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** Style the confirm button as dangerous and focus Cancel first. */
  destructive?: boolean;
  /** The action is running: the confirm button shows a spinner and closing is blocked. */
  pending?: boolean;
  /** Why the action failed, shown above the buttons. */
  error?: ReactNode;
  /** Runs the action. The caller closes the dialog (via `onOpenChange`) when it succeeds. */
  onConfirm: () => void;
}

/**
 * An `alertdialog` asking the user to confirm an action. Outside clicks never dismiss it; Esc and
 * Cancel do (except while pending). Destructive confirmations focus Cancel first, so a stray
 * Enter is harmless. Can be opened on top of another dialog or sheet.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  message,
  confirmLabel,
  cancelLabel = 'Cancel',
  destructive = false,
  pending = false,
  error,
  onConfirm,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!pending) {
          onOpenChange(next);
        }
      }}
      role="alertdialog"
      title={title}
      description={message}
      size="sm"
      fullScreenOnMobile={false}
      hideCloseButton
      onInteractOutside={(event) => {
        event.preventDefault();
      }}
      onOpenAutoFocus={(event) => {
        if (destructive) {
          event.preventDefault();
          cancelRef.current?.focus();
        }
      }}
      footer={
        <>
          <RadixDialog.Close asChild>
            <Button ref={cancelRef} variant="secondary" disabled={pending}>
              {cancelLabel}
            </Button>
          </RadixDialog.Close>
          <Button
            variant={destructive ? 'danger' : 'primary'}
            loading={pending}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <FormError message={error} />
    </Dialog>
  );
}
