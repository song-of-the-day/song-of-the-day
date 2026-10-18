import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useToday } from './useToday';

afterEach(() => {
  vi.useRealTimers();
});

function setVisibility(state: DocumentVisibilityState): void {
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(state);
}

describe('useToday', () => {
  it('returns the local date and re-reads it when the tab becomes visible or focused', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 11, 22, 0));
    const { result } = renderHook(() => useToday());
    expect(result.current).toBe('2026-10-11');

    vi.setSystemTime(new Date(2026, 9, 12, 8, 0));
    setVisibility('hidden');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(result.current).toBe('2026-10-11');

    setVisibility('visible');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(result.current).toBe('2026-10-12');

    vi.setSystemTime(new Date(2026, 9, 13, 8, 0));
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    expect(result.current).toBe('2026-10-13');
  });

  it('rolls over at local midnight and keeps rescheduling', () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(new Date(2026, 9, 11, 23, 59, 0));
    const { result } = renderHook(() => useToday());

    act(() => {
      vi.advanceTimersByTime(59_000);
    });
    expect(result.current).toBe('2026-10-11');

    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(result.current).toBe('2026-10-12');

    act(() => {
      vi.advanceTimersByTime(24 * 3_600_000);
    });
    expect(result.current).toBe('2026-10-13');
  });

  it('removes its listeners and timer on unmount', () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    const removeWindow = vi.spyOn(window, 'removeEventListener');
    const removeDocument = vi.spyOn(document, 'removeEventListener');
    const { unmount } = renderHook(() => useToday());

    unmount();

    expect(removeWindow).toHaveBeenCalledWith('focus', expect.any(Function));
    expect(removeDocument).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });
});
