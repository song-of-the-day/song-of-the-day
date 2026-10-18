import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { WIDE_VIEWPORT_QUERY } from '@/hooks/useMediaQuery';
import { mockMatchMedia } from '@/test/media';

import { Button } from './Button';
import { Sheet, type SheetProps } from './Sheet';

function renderSheet(props: Partial<SheetProps> = {}) {
  const onOpenChange = vi.fn();
  const view = render(
    <>
      <button type="button">Page button</button>
      <Sheet open onOpenChange={onOpenChange} title="customize" {...props}>
        <p>Colors</p>
      </Sheet>
    </>,
  );
  return { ...view, onOpenChange };
}

const wide = (query: string) => query === WIDE_VIEWPORT_QUERY;

function overlay(): Element | null {
  return document.querySelector('.bg-fg\\/30');
}

function requireOverlay(): Element {
  const element = overlay();
  if (element === null) {
    throw new Error('The sheet has no overlay');
  }
  return element;
}

describe('Sheet', () => {
  it('is a modal right-side panel with an overlay on wide screens', () => {
    mockMatchMedia(wide);
    renderSheet({ description: 'Changes preview live.' });

    const sheet = screen.getByRole('dialog', { name: 'customize' });
    expect(sheet).toHaveAttribute('data-layout', 'side');
    expect(sheet).toHaveAccessibleDescription('Changes preview live.');
    expect(sheet).toHaveClass('sm:w-[360px]');
    expect(overlay()).toBeInTheDocument();
  });

  it('closes on an outside click when modal', async () => {
    mockMatchMedia(wide);
    const onInteractOutside = vi.fn();
    const { onOpenChange } = renderSheet({ onInteractOutside });

    await userEvent.click(requireOverlay());

    expect(onInteractOutside).toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });

  it('lets the caller keep a modal sheet open on outside clicks and Esc', async () => {
    mockMatchMedia(wide);
    const { onOpenChange } = renderSheet({
      onInteractOutside: (event) => {
        event.preventDefault();
      },
      onEscapeKeyDown: (event) => {
        event.preventDefault();
      },
    });

    await userEvent.click(requireOverlay());
    await userEvent.keyboard('{Escape}');

    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('is a non-modal bottom sheet without an overlay on phones', async () => {
    mockMatchMedia(() => false);
    const onInteractOutside = vi.fn();
    const { onOpenChange } = renderSheet({ onInteractOutside, footer: <Button>Save</Button> });

    const sheet = screen.getByRole('dialog', { name: 'customize' });
    expect(sheet).toHaveAttribute('data-layout', 'bottom');
    expect(sheet).toHaveClass('max-h-[55vh]');
    expect(overlay()).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();

    const pageButton = screen.getByRole('button', { name: 'Page button' });
    await userEvent.click(pageButton);

    expect(onInteractOutside).toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(pageButton).toHaveFocus();
  });

  it('can be non-modal on wide screens too', async () => {
    mockMatchMedia(wide);
    const { onOpenChange } = renderSheet({ modal: false });

    expect(overlay()).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Page button' }));
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('can stay modal without dimming the page behind it', async () => {
    mockMatchMedia(wide);
    const { onOpenChange } = renderSheet({ overlay: 'none' });

    expect(screen.getByRole('dialog', { name: 'customize' })).toHaveAttribute(
      'data-layout',
      'side',
    );
    expect(overlay()).not.toBeInTheDocument();

    await userEvent.keyboard('{Escape}');
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });

  it('closes from the close button and Esc in either layout', async () => {
    const media = mockMatchMedia(() => false);
    const { onOpenChange } = renderSheet({ closeLabel: 'Close panel' });

    await userEvent.click(screen.getByRole('button', { name: 'Close panel' }));
    expect(onOpenChange).toHaveBeenLastCalledWith(false);

    act(() => {
      media.update(wide);
    });
    expect(screen.getByRole('dialog')).toHaveAttribute('data-layout', 'side');
    onOpenChange.mockClear();
    await userEvent.keyboard('{Escape}');
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });
});
