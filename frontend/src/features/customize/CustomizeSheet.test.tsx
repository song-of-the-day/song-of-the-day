import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http } from 'msw';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { queryKeys } from '@/api/keys';
import type { Theme, User } from '@/api/types';
import { WIDE_VIEWPORT_QUERY } from '@/hooks/useMediaQuery';
import { applyPreset, defaultTheme, getPreset, withField } from '@/lib/theme';
import { apiErrorResponse, fakeApi } from '@/test/fakeApi';
import { holdRequest } from '@/test/hold';
import { mockMatchMedia } from '@/test/media';
import { renderWithProviders } from '@/test/render';
import { server } from '@/test/server';

import {
  DISCARD_TITLE,
  HEX_FORMAT_MESSAGE,
  PATTERN_DISABLED_HINT,
  SAVED_MESSAGE,
  SHEET_DESCRIPTION,
} from './copy';
import { CustomizeSheet } from './CustomizeSheet';
import {
  INVALID_IMAGE_MESSAGE,
  PROCESSED_TOO_LARGE_MESSAGE,
  TOO_LARGE_MESSAGE,
  UNSUPPORTED_MESSAGE,
} from './uploadErrors';

interface HarnessProps {
  onOpenChange: (open: boolean) => void;
  onPreviewChange: (theme: Theme | null) => void;
}

function Harness({ onOpenChange, onPreviewChange }: HarnessProps) {
  const [open, setOpen] = useState(true);
  return (
    <CustomizeSheet
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        setOpen(next);
      }}
      onPreviewChange={onPreviewChange}
    />
  );
}

interface SetupOptions {
  theme?: Theme;
  wide?: boolean;
  route?: string;
}

function setup({ theme = defaultTheme(), wide = true, route = '/profile' }: SetupOptions = {}) {
  mockMatchMedia((query) => wide && query === WIDE_VIEWPORT_QUERY);
  const user = fakeApi.seedUser({ display_name: 'Ada', bio: 'breakbeats', theme });
  const onOpenChange = vi.fn<(open: boolean) => void>();
  const onPreviewChange = vi.fn<(theme: Theme | null) => void>();
  const view = renderWithProviders(
    <Harness onOpenChange={onOpenChange} onPreviewChange={onPreviewChange} />,
    { user, route },
  );
  return { ...view, user, onOpenChange, onPreviewChange };
}

function sheet(): HTMLElement {
  return screen.getByRole('dialog', { name: 'customize' });
}

function lastPreview(onPreviewChange: ReturnType<typeof setup>['onPreviewChange']): Theme {
  const theme = onPreviewChange.mock.lastCall?.[0];
  if (theme === undefined || theme === null) {
    throw new Error('No preview theme was sent');
  }
  return theme;
}

function imageFile(name = 'sky.png', type = 'image/png'): File {
  return new File(['image-bytes'], name, { type });
}

async function editHeadingFont() {
  await userEvent.selectOptions(screen.getByLabelText('Heading font'), 'vt323');
}

async function uploadImage(file: File = imageFile()) {
  await userEvent.upload(screen.getByLabelText('Upload image'), file);
}

describe('CustomizeSheet', () => {
  describe('layout and initial state', () => {
    it('opens as a side panel prefilled from the saved profile', () => {
      setup();

      expect(sheet()).toHaveAttribute('data-layout', 'side');
      expect(sheet()).toHaveAccessibleDescription(SHEET_DESCRIPTION);
      for (const title of [
        'Presets',
        'Colors',
        'Fonts',
        'Background',
        'Cards',
        'Default view',
        'Profile',
      ]) {
        expect(screen.getByRole('region', { name: title })).toBeInTheDocument();
      }
      expect(screen.getByRole('radio', { name: 'Chrome' })).toBeChecked();
      expect(screen.getByRole('textbox', { name: 'Background' })).toHaveValue('#E8E6F0');
      expect(screen.getByRole('textbox', { name: 'Text' })).toHaveValue('#1C1A24');
      expect(screen.getByLabelText('Accent color picker')).toHaveValue('#5b4bff');
      expect(screen.getByLabelText('Heading font')).toHaveValue('silkscreen');
      expect(screen.getByRole('radio', { name: 'Grid' })).toBeChecked();
      expect(screen.getByRole('radio', { name: 'Window' })).toBeChecked();
      expect(screen.getByRole('radio', { name: 'Calendar' })).toBeChecked();
      expect(screen.getByRole('textbox', { name: 'Display name' })).toHaveValue('Ada');
      expect(screen.getByRole('textbox', { name: 'Bio' })).toHaveValue('breakbeats');
      expect(screen.queryByRole('list', { name: 'Contrast warnings' })).not.toBeInTheDocument();
    });

    it('is a non-modal bottom sheet without an overlay on phones', () => {
      setup({ wide: false });

      expect(sheet()).toHaveAttribute('data-layout', 'bottom');
      expect(document.querySelector('.bg-fg\\/30')).not.toBeInTheDocument();
    });

    it('does not dim the page it previews live on wide screens either', () => {
      setup({ wide: true });

      expect(sheet()).toHaveAttribute('data-layout', 'side');
      expect(document.querySelector('.bg-fg\\/30')).not.toBeInTheDocument();
    });

    it('renders nothing while closed', () => {
      renderWithProviders(
        <CustomizeSheet open={false} onOpenChange={vi.fn()} onPreviewChange={vi.fn()} />,
        { user: fakeApi.seedUser() },
      );
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  describe('closing', () => {
    it('closes on Cancel and drops the preview', async () => {
      const { onOpenChange, onPreviewChange } = setup();
      await editHeadingFont();

      await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(onOpenChange).toHaveBeenCalledWith(false);
      expect(onPreviewChange).toHaveBeenLastCalledWith(null);
    });

    it('closes on Esc without asking when nothing changed', async () => {
      const { onPreviewChange } = setup();
      await userEvent.keyboard('{Escape}');
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(onPreviewChange).toHaveBeenLastCalledWith(null);
    });

    it('asks before discarding changes on Esc, and can keep editing', async () => {
      const { onPreviewChange } = setup();
      await editHeadingFont();

      await userEvent.keyboard('{Escape}');
      const confirm = screen.getByRole('alertdialog', { name: DISCARD_TITLE });
      expect(within(confirm).getByRole('button', { name: 'Keep editing' })).toHaveFocus();

      await userEvent.click(within(confirm).getByRole('button', { name: 'Keep editing' }));
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
      expect(sheet()).toBeInTheDocument();
      expect(screen.getByLabelText('Heading font')).toHaveValue('vt323');

      await userEvent.keyboard('{Escape}');
      await userEvent.click(screen.getByRole('button', { name: 'Discard' }));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(onPreviewChange).toHaveBeenLastCalledWith(null);
    });

    it('asks before discarding changes on ✕', async () => {
      setup();
      await editHeadingFont();

      await userEvent.click(within(sheet()).getByRole('button', { name: 'Close' }));

      expect(screen.getByRole('alertdialog', { name: DISCARD_TITLE })).toBeInTheDocument();
    });

    it('asks before discarding changes on an outside click', async () => {
      setup();
      await editHeadingFont();

      // The sheet never dims the page (it previews it live), so an outside click is any press
      // outside the panel. fireEvent bypasses userEvent's pointer-events check; the page has
      // `pointer-events: none` while the modal layer is open.
      fireEvent.pointerDown(document.documentElement);
      fireEvent.click(document.documentElement);

      expect(screen.getByRole('alertdialog', { name: DISCARD_TITLE })).toBeInTheDocument();
    });

    it('treats a hex field that is not a color yet as a change', async () => {
      setup();
      const field = screen.getByRole('textbox', { name: 'Accent' });
      await userEvent.clear(field);
      await userEvent.type(field, '#12');

      await userEvent.keyboard('{Escape}');

      expect(screen.getByRole('alertdialog', { name: DISCARD_TITLE })).toBeInTheDocument();
    });

    it('closes on back navigation instead of leaving the page', async () => {
      const { router, location, onPreviewChange } = setup({ route: '/profile' });
      await act(() => router.navigate('/profile?view=calendar'));
      expect(sheet()).toBeInTheDocument();

      await act(() => router.navigate(-1));

      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      });
      expect(location().search).toBe('?view=calendar');
      expect(onPreviewChange).toHaveBeenLastCalledWith(null);
    });

    it('asks before discarding changes on back navigation and stays on the page', async () => {
      const { router, location } = setup({ route: '/profile' });
      await act(() => router.navigate('/profile?view=calendar'));
      await editHeadingFont();

      await act(() => router.navigate(-1));

      expect(await screen.findByRole('alertdialog', { name: DISCARD_TITLE })).toBeInTheDocument();
      expect(location().search).toBe('?view=calendar');
      await userEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
      expect(sheet()).toBeInTheDocument();
    });
  });

  describe('presets', () => {
    it('applies a preset but keeps the image, its fit and the default view', async () => {
      const theme: Theme = {
        ...defaultTheme(),
        background: { pattern: 'grid', image_upload_id: 'img-1', image_fit: 'tile' },
        default_view: 'calendar',
      };
      const { onPreviewChange } = setup({ theme });

      await userEvent.click(screen.getByRole('radio', { name: 'Bubblegum' }));

      expect(lastPreview(onPreviewChange)).toEqual(applyPreset(theme, 'bubblegum'));
      expect(lastPreview(onPreviewChange)).toMatchObject({
        preset: 'bubblegum',
        colors: getPreset('bubblegum').theme.colors,
        background: { pattern: 'dots', image_upload_id: 'img-1', image_fit: 'tile' },
        card_style: 'polaroid',
        default_view: 'calendar',
      });
      expect(screen.getByRole('radio', { name: 'Bubblegum' })).toBeChecked();
      expect(screen.getByRole('textbox', { name: 'Background' })).toHaveValue('#FFE3F0');
      expect(screen.getByLabelText('Heading font')).toHaveValue('pacifico');
    });

    it('switches to "custom" once a field is edited', async () => {
      setup();
      expect(screen.queryByText('✧ custom')).not.toBeInTheDocument();

      await userEvent.click(screen.getByRole('radio', { name: 'Polaroid' }));

      expect(screen.getByText('✧ custom')).toBeInTheDocument();
      for (const radio of within(screen.getByRole('radiogroup', { name: 'Preset' })).getAllByRole(
        'radio',
      )) {
        expect(radio).not.toBeChecked();
      }
    });

    it('starts with no preset checked for a custom theme', () => {
      setup({ theme: withField(defaultTheme(), { card_style: 'minimal' }) });

      expect(screen.getByText('✧ custom')).toBeInTheDocument();
      expect(screen.getByRole('radio', { name: 'Chrome' })).not.toBeChecked();
    });
  });

  describe('colors', () => {
    it('previews a valid hex color as soon as it is typed and normalizes it on blur', async () => {
      const { onPreviewChange } = setup();
      const field = screen.getByRole('textbox', { name: 'Accent' });

      await userEvent.clear(field);
      await userEvent.type(field, 'ff00aa');

      expect(lastPreview(onPreviewChange).colors.accent).toBe('#FF00AA');
      expect(lastPreview(onPreviewChange).preset).toBe('custom');
      expect(screen.getByLabelText('Accent color picker')).toHaveValue('#ff00aa');
      expect(field).toHaveValue('ff00aa');

      await userEvent.tab();
      expect(field).toHaveValue('#FF00AA');
      expect(field).toBeValid();
    });

    it('shows a format error for invalid hex text after leaving the field', async () => {
      const { onPreviewChange } = setup();
      const field = screen.getByRole('textbox', { name: 'Text' });

      await userEvent.clear(field);
      await userEvent.type(field, '#12345G');
      expect(screen.queryByText(HEX_FORMAT_MESSAGE)).not.toBeInTheDocument();
      await userEvent.tab();

      expect(field).toBeInvalid();
      expect(field).toHaveAccessibleDescription(HEX_FORMAT_MESSAGE);
      expect(onPreviewChange).not.toHaveBeenCalled();

      await userEvent.clear(field);
      await userEvent.type(field, '#000000');
      expect(field).toBeValid();
      expect(lastPreview(onPreviewChange).colors.text).toBe('#000000');
    });

    it('keeps the preset when the typed color equals the current one', async () => {
      const { onPreviewChange } = setup();
      const field = screen.getByRole('textbox', { name: 'Accent' });

      await userEvent.clear(field);
      await userEvent.type(field, '#5b4bff');
      await userEvent.tab();

      expect(onPreviewChange).not.toHaveBeenCalled();
      expect(field).toHaveValue('#5B4BFF');
      expect(screen.getByRole('radio', { name: 'Chrome' })).toBeChecked();
    });

    it('updates the color and its hex text from the native picker', () => {
      const { onPreviewChange } = setup();

      fireEvent.change(screen.getByLabelText('Lines & shadows color picker'), {
        target: { value: '#00ff00' },
      });

      expect(lastPreview(onPreviewChange).colors.border).toBe('#00FF00');
      expect(screen.getByRole('textbox', { name: 'Lines & shadows' })).toHaveValue('#00FF00');
    });

    it('warns about hard-to-read color pairs without blocking', async () => {
      setup();
      const surface = screen.getByRole('textbox', { name: 'Cards & panels' });

      await userEvent.clear(surface);
      await userEvent.type(surface, '#1C1A24');

      const warnings = screen.getByRole('list', { name: 'Contrast warnings' });
      expect(
        within(warnings).getByText('Text on cards is hard to read (1.0:1, needs 4.5:1)'),
      ).toBeVisible();
      expect(within(warnings).getAllByRole('listitem').length).toBeGreaterThanOrEqual(2);
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    });
  });

  describe('fonts', () => {
    it('lists every font in its own typeface and previews the choice', async () => {
      const { onPreviewChange } = setup();
      const heading = screen.getByLabelText('Heading font');

      const options = within(heading).getAllByRole('option');
      expect(options).toHaveLength(10);
      expect(within(heading).getByRole('option', { name: 'VT323' })).toHaveStyle({
        fontFamily: "'VT323', ui-monospace, monospace",
      });

      await userEvent.selectOptions(screen.getByLabelText('Body font'), 'courier-prime');
      expect(lastPreview(onPreviewChange).fonts).toEqual({
        heading: 'silkscreen',
        body: 'courier-prime',
      });
      const sample = screen.getByRole('group', { name: 'Font sample' });
      expect(within(sample).getByText('The track I had on repeat all afternoon.')).toHaveStyle({
        fontFamily: "'Courier Prime', 'Courier New', monospace",
      });
    });
  });

  describe('background', () => {
    it('previews a pattern choice', async () => {
      const { onPreviewChange } = setup();

      await userEvent.click(screen.getByRole('radio', { name: 'Stars' }));

      expect(lastPreview(onPreviewChange).background.pattern).toBe('stars');
    });

    it('uploads an image, disables patterns, and offers fit and removal', async () => {
      const { onPreviewChange } = setup();

      await uploadImage();

      const image = await screen.findByRole('img', { name: 'Current background' });
      const uploadId = lastPreview(onPreviewChange).background.image_upload_id;
      expect(uploadId).not.toBeNull();
      expect(fakeApi.hasUpload(String(uploadId))).toBe(true);
      expect(image).toHaveAttribute('src', `/api/uploads/${String(uploadId)}`);
      expect(screen.getByRole('radiogroup', { name: 'Pattern' })).toBeDisabled();
      expect(screen.getByRole('radiogroup', { name: 'Pattern' })).toHaveAccessibleDescription(
        PATTERN_DISABLED_HINT,
      );
      expect(screen.getByLabelText('Replace image')).toBeInTheDocument();

      await userEvent.click(screen.getByRole('radio', { name: 'Tile' }));
      expect(lastPreview(onPreviewChange).background.image_fit).toBe('tile');

      await userEvent.click(screen.getByRole('button', { name: 'Remove image' }));
      expect(lastPreview(onPreviewChange).background.image_upload_id).toBeNull();
      expect(screen.queryByRole('img', { name: 'Current background' })).not.toBeInTheDocument();
      expect(screen.getByRole('radiogroup', { name: 'Pattern' })).toBeEnabled();
    });

    it('shows a spinner and blocks Save while uploading', async () => {
      setup();
      const held = holdRequest('post', '/api/uploads', () =>
        apiErrorResponse(422, 'invalid_image', 'Bad image.'),
      );

      await uploadImage();

      expect(await screen.findByText('Uploading image…')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
      held.release();
      expect(await screen.findByText(INVALID_IMAGE_MESSAGE)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    });

    it('rejects files over 10 MB before uploading', async () => {
      setup();
      const big = imageFile('huge.png');
      Object.defineProperty(big, 'size', { value: 10 * 1024 * 1024 + 1 });

      await uploadImage(big);

      expect(screen.getByText(TOO_LARGE_MESSAGE)).toBeInTheDocument();
      expect(screen.getByLabelText('Upload image')).toBeInvalid();
      expect(fakeApi.requests.some((request) => request.path === '/api/uploads')).toBe(false);
    });

    it.each([
      [413, 'payload_too_large', PROCESSED_TOO_LARGE_MESSAGE],
      [415, 'unsupported_media_type', UNSUPPORTED_MESSAGE],
      [422, 'invalid_image', INVALID_IMAGE_MESSAGE],
      [429, 'rate_limited', 'Too many attempts. Wait a few minutes and try again.'],
    ])('explains a %i %s upload failure', async (status, code, message) => {
      setup();
      server.use(http.post('/api/uploads', () => apiErrorResponse(status, code, 'Nope.')));

      await uploadImage();

      expect(await screen.findByText(message)).toBeInTheDocument();
      expect(screen.queryByRole('img', { name: 'Current background' })).not.toBeInTheDocument();
    });
  });

  describe('cards', () => {
    it('previews the card style and default view', async () => {
      const { onPreviewChange } = setup();

      await userEvent.click(screen.getByRole('radio', { name: 'Minimal' }));
      expect(lastPreview(onPreviewChange).card_style).toBe('minimal');

      await userEvent.click(screen.getByRole('radio', { name: 'Calendar' }));
      expect(lastPreview(onPreviewChange).default_view).toBe('calendar');
    });
  });

  describe('saving', () => {
    it('saves the profile fields and the full theme, then closes', async () => {
      const { user, queryClient, onPreviewChange } = setup();
      await editHeadingFont();
      await userEvent.click(screen.getByRole('radio', { name: 'Calendar' }));
      const name = screen.getByRole('textbox', { name: 'Display name' });
      await userEvent.clear(name);
      await userEvent.type(name, '  Ada L  ');
      const bio = screen.getByRole('textbox', { name: 'Bio' });
      await userEvent.clear(bio);
      await userEvent.type(bio, 'jungle forever');

      await userEvent.click(screen.getByRole('button', { name: 'Save' }));

      expect(await screen.findByText(SAVED_MESSAGE)).toBeInTheDocument();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(onPreviewChange).toHaveBeenLastCalledWith(null);
      const expectedTheme = withField(defaultTheme(), {
        fonts: { heading: 'vt323' },
        default_view: 'calendar',
      });
      const saved = fakeApi.getUser(user.id);
      expect(saved).toMatchObject({ display_name: 'Ada L', bio: 'jungle forever' });
      expect(saved?.theme).toEqual(expectedTheme);
      expect(queryClient.getQueryData<User>(queryKeys.me())?.theme).toEqual(expectedTheme);
    });

    it('saves an uploaded image', async () => {
      const { user, onPreviewChange } = setup();
      await uploadImage();
      await screen.findByRole('img', { name: 'Current background' });
      const uploadId = lastPreview(onPreviewChange).background.image_upload_id;

      await userEvent.click(screen.getByRole('button', { name: 'Save' }));

      await waitFor(() => {
        expect(fakeApi.getUser(user.id)?.theme.background.image_upload_id).toBe(uploadId);
      });
    });

    it('closes without a request when nothing changed', async () => {
      setup();

      await userEvent.click(screen.getByRole('button', { name: 'Save' }));

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(fakeApi.requests.some((request) => request.method === 'PATCH')).toBe(false);
    });

    it('validates the display name and hex fields before saving', async () => {
      setup();
      const accent = screen.getByRole('textbox', { name: 'Accent' });
      await userEvent.clear(accent);
      await userEvent.type(accent, 'blue');
      await userEvent.clear(screen.getByRole('textbox', { name: 'Display name' }));

      await userEvent.click(screen.getByRole('button', { name: 'Save' }));

      expect(accent).toHaveFocus();
      expect(accent).toHaveAccessibleDescription(HEX_FORMAT_MESSAGE);
      expect(screen.getByRole('textbox', { name: 'Display name' })).toHaveAccessibleDescription(
        /Enter a display name\./,
      );
      expect(fakeApi.requests.some((request) => request.method === 'PATCH')).toBe(false);

      await userEvent.type(screen.getByRole('textbox', { name: 'Display name' }), 'A');
      expect(screen.queryByText('Enter a display name.')).not.toBeInTheDocument();
    });

    it('rejects a display name over 50 characters and limits the bio to 280', async () => {
      setup();
      const name = screen.getByRole('textbox', { name: 'Display name' });
      await userEvent.clear(name);
      await userEvent.type(name, 'x'.repeat(51));

      await userEvent.click(screen.getByRole('button', { name: 'Save' }));

      expect(name).toHaveFocus();
      expect(name).toHaveAccessibleDescription(/Use at most 50 characters\./);
      const bio = screen.getByRole('textbox', { name: 'Bio' });
      expect(bio).toHaveAttribute('maxlength', '280');
      expect(bio).toHaveAccessibleDescription('10 of 280 characters used');
    });

    it('shows the server message for an image that is no longer available', async () => {
      setup();
      await uploadImage();
      await screen.findByRole('img', { name: 'Current background' });
      server.use(
        http.patch('/api/profile', () =>
          apiErrorResponse(422, 'validation_error', 'Some fields are invalid.', {
            fields: {
              'theme.background.image_upload_id':
                'This image is no longer available; upload it again.',
            },
          }),
        ),
      );

      await userEvent.click(screen.getByRole('button', { name: 'Save' }));

      const input = await screen.findByLabelText('Replace image');
      await waitFor(() => {
        expect(input).toHaveFocus();
      });
      expect(input).toHaveAccessibleDescription(
        /This image is no longer available; upload it again\./,
      );
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(sheet()).toBeInTheDocument();
    });

    it('maps color and display name field errors to their controls', async () => {
      setup();
      await editHeadingFont();
      server.use(
        http.patch('/api/profile', () =>
          apiErrorResponse(422, 'validation_error', 'Some fields are invalid.', {
            fields: {
              display_name: 'Too long.',
              'theme.colors.text': 'Must be a #RRGGBB color.',
              'theme.unknown': 'Unknown field.',
            },
          }),
        ),
      );

      await userEvent.click(screen.getByRole('button', { name: 'Save' }));

      const text = screen.getByRole('textbox', { name: 'Text' });
      await waitFor(() => {
        expect(text).toHaveFocus();
      });
      expect(text).toHaveAccessibleDescription('Must be a #RRGGBB color.');
      expect(screen.getByRole('textbox', { name: 'Display name' })).toHaveAccessibleDescription(
        /Too long\./,
      );
      expect(screen.getByRole('alert')).toHaveTextContent('Some fields are invalid.');

      await userEvent.type(text, '{backspace}0');
      expect(text).not.toHaveAccessibleDescription('Must be a #RRGGBB color.');
    });

    it('shows a form error when saving fails and keeps the draft', async () => {
      const { onPreviewChange } = setup();
      await editHeadingFont();
      server.use(http.patch('/api/profile', () => apiErrorResponse(500, 'internal_error', 'Boom')));

      await userEvent.click(screen.getByRole('button', { name: 'Save' }));

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Something went wrong on our side. Please try again.',
      );
      expect(sheet()).toBeInTheDocument();
      expect(onPreviewChange).not.toHaveBeenLastCalledWith(null);
    });

    it('ignores closing while a save is in flight', async () => {
      setup();
      await editHeadingFont();
      const held = holdRequest('patch', '/api/profile', () =>
        apiErrorResponse(500, 'internal_error', 'Boom'),
      );

      await userEvent.click(screen.getByRole('button', { name: 'Save' }));
      await waitFor(() => {
        expect(held.calls).toBe(1);
      });
      await userEvent.keyboard('{Escape}');

      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
      expect(sheet()).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
      held.release();
      expect(await screen.findByRole('alert')).toBeInTheDocument();
    });
  });
});
