import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ConfirmDialog, type ConfirmDialogProps } from './ConfirmDialog';

function renderConfirm(props: Partial<ConfirmDialogProps> = {}) {
  const onOpenChange = vi.fn();
  const onConfirm = vi.fn();
  const view = render(
    <ConfirmDialog
      open
      onOpenChange={onOpenChange}
      onConfirm={onConfirm}
      title="Delete this song?"
      message="Delete this day's song and its 2 notes?"
      confirmLabel="Delete"
      {...props}
    />,
  );
  return { ...view, onOpenChange, onConfirm };
}

describe('ConfirmDialog', () => {
  it('is an alertdialog describing the action', () => {
    renderConfirm();

    const dialog = screen.getByRole('alertdialog', { name: 'Delete this song?' });
    expect(dialog).toHaveAccessibleDescription("Delete this day's song and its 2 notes?");
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
  });

  it('confirms with the confirm button', async () => {
    const { onConfirm } = renderConfirm();

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('focuses Cancel first for destructive actions and styles confirm as danger', () => {
    renderConfirm({ destructive: true, cancelLabel: 'Keep it' });

    expect(screen.getByRole('button', { name: 'Keep it' })).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Delete' })).toHaveClass('bg-fg');
  });

  it('cancels with Cancel and Esc but not with an outside click', async () => {
    const { onOpenChange } = renderConfirm();

    const overlay = document.querySelector('.bg-fg\\/40');
    if (overlay === null) {
      throw new Error('The dialog has no overlay');
    }
    await userEvent.click(overlay);
    expect(onOpenChange).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onOpenChange).toHaveBeenLastCalledWith(false);

    onOpenChange.mockClear();
    await userEvent.keyboard('{Escape}');
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });

  it('blocks closing and repeated confirms while pending', async () => {
    const { onOpenChange, onConfirm } = renderConfirm({ pending: true });

    const confirm = screen.getByRole('button', { name: 'Delete' });
    expect(confirm).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();

    await userEvent.click(confirm);
    await userEvent.keyboard('{Escape}');
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('shows why the action failed', () => {
    renderConfirm({ error: "Couldn't delete. Try again." });

    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't delete. Try again.");
  });
});
