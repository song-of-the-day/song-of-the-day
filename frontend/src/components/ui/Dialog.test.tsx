import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Button } from './Button';
import { Dialog, type DialogProps } from './Dialog';

function renderDialog(props: Partial<DialogProps> = {}) {
  const onOpenChange = vi.fn();
  const view = render(
    <Dialog open onOpenChange={onOpenChange} title="log a song" {...props}>
      <p>Pick a song.</p>
    </Dialog>,
  );
  return { ...view, onOpenChange };
}

describe('Dialog', () => {
  it('is a modal dialog named by its title in a window title bar', () => {
    renderDialog({ description: 'Logging for Sun, Oct 11' });

    const dialog = screen.getByRole('dialog', { name: 'log a song' });
    expect(dialog).toHaveAccessibleDescription('Logging for Sun, Oct 11');
    expect(dialog).toHaveClass('y2k-window');
    expect(dialog.querySelector('.y2k-titlebar .y2k-dots')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText('Pick a song.')).toBeInTheDocument();
  });

  it('has no description unless given one', () => {
    renderDialog();

    expect(screen.getByRole('dialog')).not.toHaveAttribute('aria-describedby');
  });

  it('closes from the close button and Esc', async () => {
    const { onOpenChange } = renderDialog({ closeLabel: 'Close dialog' });

    await userEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
    expect(onOpenChange).toHaveBeenLastCalledWith(false);

    onOpenChange.mockClear();
    await userEvent.keyboard('{Escape}');
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });

  it('lets the caller intercept Esc', async () => {
    const onEscapeKeyDown = vi.fn((event: KeyboardEvent) => {
      event.preventDefault();
    });
    const { onOpenChange } = renderDialog({ onEscapeKeyDown });

    await userEvent.keyboard('{Escape}');
    expect(onEscapeKeyDown).toHaveBeenCalledTimes(1);
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('fills the screen on phones by default and can stay centered', () => {
    const { rerender, onOpenChange } = renderDialog({ size: 'lg' });
    expect(screen.getByRole('dialog')).toHaveClass('inset-0', 'h-dvh', 'sm:max-w-2xl');

    rerender(
      <Dialog open onOpenChange={onOpenChange} title="t" size="sm" fullScreenOnMobile={false}>
        x
      </Dialog>,
    );
    expect(screen.getByRole('dialog')).not.toHaveClass('inset-0');
    expect(screen.getByRole('dialog')).toHaveClass('w-[calc(100%-2rem)]', 'sm:max-w-sm');
  });

  it('renders a footer, an alertdialog role and no close button on request', () => {
    renderDialog({
      role: 'alertdialog',
      hideCloseButton: true,
      footer: <Button>Save</Button>,
      bodyClassName: 'p-0',
    });

    expect(screen.getByRole('alertdialog', { name: 'log a song' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    expect(screen.getByText('Pick a song.').parentElement).toHaveClass('p-0');
  });

  it('traps focus inside and returns it to the opener on close', async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <Button
            onClick={() => {
              setOpen(true);
            }}
          >
            Open
          </Button>
          <Dialog open={open} onOpenChange={setOpen} title="account">
            <Button>Inside</Button>
          </Dialog>
        </>
      );
    }
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Open' });

    await userEvent.click(opener);
    expect(screen.getByRole('dialog')).toContainElement(document.activeElement as HTMLElement);

    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });
});
