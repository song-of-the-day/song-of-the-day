import { act, fireEvent, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_TOAST_DURATION_MS, MAX_TOASTS, ToastProvider } from './Toast';
import { useToast, type ToastApi } from './useToast';

function renderProvider(): { current: ToastApi } {
  return renderHook(() => useToast(), { wrapper: ToastProvider }).result;
}

describe('ToastProvider', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows messages in a polite live region', () => {
    const toasts = renderProvider();

    act(() => {
      toasts.current.show('Saved ✦', { tone: 'success' });
    });

    const list = screen.getByRole('list', { name: 'Notifications' });
    expect(list.parentElement).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByRole('listitem')).toHaveTextContent('Saved ✦');
    expect(screen.getByRole('listitem')).toHaveAttribute('data-tone', 'success');
  });

  it('dismisses itself after the duration', () => {
    const toasts = renderProvider();
    act(() => {
      toasts.current.show('Logged');
    });
    expect(screen.getByRole('listitem')).toHaveAttribute('data-tone', 'info');

    act(() => {
      vi.advanceTimersByTime(DEFAULT_TOAST_DURATION_MS - 1);
    });
    expect(screen.getByText('Logged')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByText('Logged')).not.toBeInTheDocument();
  });

  it('pauses while hovered or focused', () => {
    const toasts = renderProvider();
    act(() => {
      toasts.current.show('Hold on', { durationMs: 1000 });
    });
    const item = screen.getByRole('listitem');

    fireEvent.mouseEnter(item);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByText('Hold on')).toBeInTheDocument();

    fireEvent.mouseLeave(item);
    const dismiss = screen.getByRole('button', { name: 'Dismiss notification' });
    act(() => {
      dismiss.focus();
    });
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByText('Hold on')).toBeInTheDocument();

    fireEvent.blur(dismiss, { relatedTarget: item });
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByText('Hold on')).toBeInTheDocument();

    act(() => {
      dismiss.blur();
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.queryByText('Hold on')).not.toBeInTheDocument();
  });

  it('dismisses from the button or the API', () => {
    const toasts = renderProvider();
    let second = 0;
    act(() => {
      toasts.current.show('First');
      second = toasts.current.show('Second', { tone: 'error' });
    });

    fireEvent.click(screen.getAllByRole('button', { name: 'Dismiss notification' })[0] as Element);
    expect(screen.queryByText('First')).not.toBeInTheDocument();

    act(() => {
      toasts.current.dismiss(second);
    });
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
  });

  it(`keeps at most ${String(MAX_TOASTS)} toasts, dropping the oldest`, () => {
    const toasts = renderProvider();
    act(() => {
      for (let index = 1; index <= MAX_TOASTS + 1; index += 1) {
        toasts.current.show(`Toast ${String(index)}`);
      }
    });

    expect(screen.getAllByRole('listitem')).toHaveLength(MAX_TOASTS);
    expect(screen.queryByText('Toast 1')).not.toBeInTheDocument();
    expect(screen.getByText(`Toast ${String(MAX_TOASTS + 1)}`)).toBeInTheDocument();
  });
});

describe('useToast', () => {
  it('throws outside a ToastProvider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(() => renderHook(() => useToast())).toThrow(
      'useToast must be used inside a ToastProvider',
    );
  });
});
