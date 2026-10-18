import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';

import { LINK_COPIED_MESSAGE, ShareButton } from './ShareButton';

const PROFILE = { display_name: 'Ada Lovelace', username: 'ada' };
const URL = `${window.location.origin}/ada`;
const TITLE = 'Ada Lovelace (@ada) · song of the day';

/** Gives jsdom (which has no Web Share API) a `navigator.share`. */
function mockShare(implementation: () => Promise<void>) {
  const share = vi.fn<(data?: ShareData) => Promise<void>>(implementation);
  Object.defineProperty(navigator, 'share', { configurable: true, writable: true, value: share });
  return share;
}

function renderShare() {
  const user = userEvent.setup();
  renderWithProviders(<ShareButton profile={PROFILE} />);
  return { user, button: screen.getByRole('button', { name: 'Share' }) };
}

async function expectFallbackField() {
  const dialog = await screen.findByRole('dialog', { name: 'your link' });
  const field = within(dialog).getByRole('textbox', { name: 'Profile link' });
  expect(field).toHaveValue(URL);
  expect(field).toHaveAttribute('readonly');
  expect(field).toHaveFocus();
  expect(field).toHaveProperty('selectionStart', 0);
  expect(field).toHaveProperty('selectionEnd', URL.length);
  expect(screen.queryByText(LINK_COPIED_MESSAGE)).not.toBeInTheDocument();
}

afterEach(() => {
  Reflect.deleteProperty(navigator, 'share');
});

describe('ShareButton', () => {
  it('shows a labelled share icon button', () => {
    const { button } = renderShare();

    expect(button).toHaveTextContent('Share');
    expect(button.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  describe('with the Web Share API', () => {
    it("opens the share sheet with the profile's title and link", async () => {
      const share = mockShare(() => Promise.resolve());
      const { user, button } = renderShare();

      await user.click(button);

      expect(share).toHaveBeenCalledExactlyOnceWith({ title: TITLE, url: URL });
      await expect(navigator.clipboard.readText()).resolves.toBe('');
      expect(screen.queryByText(LINK_COPIED_MESSAGE)).not.toBeInTheDocument();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('stays silent when the share sheet is dismissed', async () => {
      const share = mockShare(() =>
        Promise.reject(new DOMException('Share canceled', 'AbortError')),
      );
      const { user, button } = renderShare();

      await user.click(button);

      await waitFor(() => {
        expect(share).toHaveBeenCalledOnce();
      });
      await expect(navigator.clipboard.readText()).resolves.toBe('');
      expect(screen.queryByText(LINK_COPIED_MESSAGE)).not.toBeInTheDocument();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it.each([
      ['a refused share', new DOMException('Not allowed', 'NotAllowedError')],
      ['an unexpected error', new TypeError('Invalid share data')],
    ])('copies the link instead after %s', async (_case, error) => {
      mockShare(() => Promise.reject(error));
      const { user, button } = renderShare();

      await user.click(button);

      expect(await screen.findByText(LINK_COPIED_MESSAGE)).toBeInTheDocument();
      await expect(navigator.clipboard.readText()).resolves.toBe(URL);
    });

    it('shows the link in a field when neither sharing nor copying works', async () => {
      mockShare(() => Promise.reject(new DOMException('Not allowed', 'NotAllowedError')));
      const { user, button } = renderShare();
      vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'));

      await user.click(button);

      await expectFallbackField();
    });
  });

  describe('without the Web Share API', () => {
    it('copies the link and confirms with a toast', async () => {
      const { user, button } = renderShare();

      await user.click(button);

      expect(await screen.findByText(LINK_COPIED_MESSAGE)).toBeInTheDocument();
      await expect(navigator.clipboard.readText()).resolves.toBe(URL);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('falls back to a selectable field when the clipboard refuses', async () => {
      const { user, button } = renderShare();
      vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'));

      await user.click(button);

      await expectFallbackField();
    });

    it('falls back when there is no clipboard at all', async () => {
      const { user, button } = renderShare();
      const withoutClipboard = Object.create(navigator) as Navigator;
      Object.defineProperty(withoutClipboard, 'clipboard', { value: undefined });
      vi.stubGlobal('navigator', withoutClipboard);

      await user.click(button);

      await expectFallbackField();
    });

    it('closes the fallback field', async () => {
      const { user, button } = renderShare();
      vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'));
      await user.click(button);
      await screen.findByRole('dialog', { name: 'your link' });

      await user.keyboard('{Escape}');

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(button).toHaveFocus();
    });
  });
});
