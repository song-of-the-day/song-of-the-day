import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SEARCH_DEBOUNCE_MS, useDebouncedValue } from './useDebouncedValue';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useDebouncedValue', () => {
  it('passes the value through after it stops changing', () => {
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value), {
      initialProps: { value: 'g' },
    });
    expect(result.current).toBe('g');

    rerender({ value: 'go' });
    act(() => {
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 1);
    });
    rerender({ value: 'gos' });
    act(() => {
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 1);
    });
    expect(result.current).toBe('g');

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe('gos');
  });

  it('uses a custom delay', () => {
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 50), {
      initialProps: { value: 1 },
    });

    rerender({ value: 2 });
    act(() => {
      vi.advanceTimersByTime(50);
    });

    expect(result.current).toBe(2);
    expect(SEARCH_DEBOUNCE_MS).toBe(300);
  });
});
