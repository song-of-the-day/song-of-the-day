import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useReturnFocus } from './useReturnFocus';

function button(label: string): HTMLButtonElement {
  const element = document.createElement('button');
  element.textContent = label;
  document.body.append(element);
  return element;
}

describe('useReturnFocus', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it('refocuses the element that was focused when the dialog opened', () => {
    const opener = button('Open');
    const elsewhere = button('Elsewhere');
    const onOpen = vi.fn();
    const { result } = renderHook(() => useReturnFocus(onOpen));

    opener.focus();
    result.current.onOpenAutoFocus(new Event('focusScope.autoFocusOnMount'));
    elsewhere.focus();
    const close = new Event('focusScope.autoFocusOnUnmount', { cancelable: true });
    result.current.onCloseAutoFocus(close);

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(close.defaultPrevented).toBe(true);
    expect(opener).toHaveFocus();
  });

  it('leaves focus to a caller that prevents the default', () => {
    const opener = button('Open');
    const elsewhere = button('Elsewhere');
    const { result } = renderHook(() =>
      useReturnFocus(undefined, (event) => {
        event.preventDefault();
        elsewhere.focus();
      }),
    );

    opener.focus();
    result.current.onOpenAutoFocus(new Event('mount'));
    result.current.onCloseAutoFocus(new Event('unmount', { cancelable: true }));

    expect(elsewhere).toHaveFocus();
  });

  it('does nothing when the opener is gone or was the page itself', () => {
    const opener = button('Open');
    const { result } = renderHook(() => useReturnFocus());

    opener.focus();
    result.current.onOpenAutoFocus(new Event('mount'));
    opener.remove();
    result.current.onCloseAutoFocus(new Event('unmount', { cancelable: true }));
    expect(document.body).toHaveFocus();

    result.current.onOpenAutoFocus(new Event('mount'));
    const close = new Event('unmount', { cancelable: true });
    result.current.onCloseAutoFocus(close);
    expect(close.defaultPrevented).toBe(true);
    expect(document.body).toHaveFocus();
  });
});
