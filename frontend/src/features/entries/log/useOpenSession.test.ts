import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useOpenSession } from './useOpenSession';

describe('useOpenSession', () => {
  it('counts openings and keeps the number while closed', () => {
    const { result, rerender } = renderHook(({ open }) => useOpenSession(open), {
      initialProps: { open: false },
    });
    expect(result.current).toBe(0);

    rerender({ open: true });
    expect(result.current).toBe(1);

    rerender({ open: true });
    expect(result.current).toBe(1);

    rerender({ open: false });
    expect(result.current).toBe(1);

    rerender({ open: true });
    expect(result.current).toBe(2);
  });

  it('starts at 1 when mounted open', () => {
    const { result } = renderHook(() => useOpenSession(true));

    expect(result.current).toBe(1);
  });
});
