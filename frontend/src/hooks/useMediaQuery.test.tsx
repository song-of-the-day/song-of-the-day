import { act, renderHook } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { mockMatchMedia } from '@/test/media';

import { useMediaQuery, WIDE_VIEWPORT_QUERY } from './useMediaQuery';

describe('useMediaQuery', () => {
  it('returns whether the query matches', () => {
    mockMatchMedia((query) => query === WIDE_VIEWPORT_QUERY);

    const wide = renderHook(() => useMediaQuery(WIDE_VIEWPORT_QUERY));
    const print = renderHook(() => useMediaQuery('print'));

    expect(wide.result.current).toBe(true);
    expect(print.result.current).toBe(false);
  });

  it('re-renders when the result changes', () => {
    const media = mockMatchMedia(() => false);
    const { result } = renderHook(() => useMediaQuery(WIDE_VIEWPORT_QUERY));

    act(() => {
      media.update(() => true);
    });
    expect(result.current).toBe(true);

    act(() => {
      media.update(() => false);
    });
    expect(result.current).toBe(false);
  });

  it('follows a changed query and stops listening after unmount', () => {
    const media = mockMatchMedia((query) => query === 'a');
    const { result, rerender, unmount } = renderHook(({ query }) => useMediaQuery(query), {
      initialProps: { query: 'a' },
    });
    expect(result.current).toBe(true);

    rerender({ query: 'b' });
    expect(result.current).toBe(false);

    unmount();
    expect(() => {
      media.update(() => true);
    }).not.toThrow();
  });

  it('reports no match when rendering on a server', () => {
    mockMatchMedia(() => true);
    function Probe() {
      return <span>{String(useMediaQuery(WIDE_VIEWPORT_QUERY))}</span>;
    }

    expect(renderToString(<Probe />)).toBe('<span>false</span>');
  });
});
