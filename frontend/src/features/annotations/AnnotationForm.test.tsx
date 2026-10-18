import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import { SERVER_ERROR_MESSAGE } from '@/api/messages';
import type { Annotation } from '@/api/types';
import { apiErrorResponse, fakeApi } from '@/test/fakeApi';
import { renderWithProviders } from '@/test/render';
import { server } from '@/test/server';

import {
  ANNOTATION_LIMIT_MESSAGE,
  AnnotationForm,
  type AnnotationFormProps,
} from './AnnotationForm';
import {
  BODY_REQUIRED_MESSAGE,
  END_BEFORE_START_MESSAGE,
  START_REQUIRED_MESSAGE,
} from './noteForm';

const ANNOTATIONS_PATH = /^\/api\/entries\/\d+\/annotations/;

function setup(props: Partial<AnnotationFormProps> = {}) {
  const user = fakeApi.seedUser();
  const entry = fakeApi.seedEntry(user.id);
  const onSaved = vi.fn<(annotation: Annotation) => void>();
  const onCancel = vi.fn();
  renderWithProviders(
    <AnnotationForm entryId={entry.id} onSaved={onSaved} onCancel={onCancel} {...props} />,
    { user },
  );
  return {
    entry,
    onSaved,
    onCancel,
    start: screen.getByRole('textbox', { name: 'Start' }),
    end: screen.getByRole('textbox', { name: 'End (optional)' }),
    body: screen.getByRole('textbox', { name: 'Note' }),
  };
}

function annotationRequests() {
  return fakeApi.requests.filter((request) => ANNOTATIONS_PATH.test(request.path));
}

describe('AnnotationForm', () => {
  it('creates a point note in yellow by default', async () => {
    const { start, body, onSaved, entry } = setup();
    expect(start).toHaveFocus();
    expect(screen.getByRole('radio', { name: 'Yellow' })).toBeChecked();

    await userEvent.type(start, '1:23');
    await userEvent.type(body, 'goosebumps{Enter}every time');
    await userEvent.click(screen.getByRole('button', { name: 'Add note' }));

    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledTimes(1);
    });
    expect(fakeApi.getEntry(entry.id)?.annotations).toEqual([
      expect.objectContaining({
        start_ms: 83_000,
        end_ms: null,
        body: 'goosebumps\nevery time',
        color: 'yellow',
      }),
    ]);
    expect(onSaved.mock.calls[0]?.[0]).toMatchObject({ start_ms: 83_000, end_ms: null });
  });

  it('creates a range in the chosen color, prefilled from the timeline', async () => {
    const { start, end, body, onSaved, entry } = setup({
      initialStartMs: 50_000,
      initialEndMs: 100_000,
    });
    expect(start).toHaveValue('0:50');
    expect(end).toHaveValue('1:40');
    expect(body).toHaveFocus();

    await userEvent.type(body, 'the bridge');
    await userEvent.click(screen.getByRole('radio', { name: 'Purple' }));
    expect(screen.getByRole('radio', { name: 'Purple' })).toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: 'Add note' }));

    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledTimes(1);
    });
    expect(fakeApi.getEntry(entry.id)?.annotations[0]).toMatchObject({
      start_ms: 50_000,
      end_ms: 100_000,
      body: 'the bridge',
      color: 'purple',
    });
  });

  it('shows the counter for the text', async () => {
    const { body } = setup();

    await userEvent.type(body, 'hey');

    expect(screen.getByText('3 / 1000')).toBeInTheDocument();
    expect(body).toHaveAttribute('maxLength', '1000');
  });

  it('checks the fields before saving and focuses the first problem', async () => {
    const { start, end, body } = setup();

    await userEvent.click(screen.getByRole('button', { name: 'Add note' }));

    expect(start).toHaveAccessibleDescription(expect.stringContaining(START_REQUIRED_MESSAGE));
    expect(body).toHaveAccessibleDescription(expect.stringContaining(BODY_REQUIRED_MESSAGE));
    expect(start).toHaveFocus();

    await userEvent.type(start, '2:00');
    await userEvent.type(end, '1:59');
    await userEvent.type(body, 'x');
    await userEvent.click(screen.getByRole('button', { name: 'Add note' }));

    expect(end).toHaveAccessibleDescription(expect.stringContaining(END_BEFORE_START_MESSAGE));
    expect(end).toHaveFocus();
    expect(start).not.toHaveAttribute('aria-invalid');
    expect(annotationRequests()).toHaveLength(0);
  });

  it("maps the API's field errors to the fields", async () => {
    server.use(
      http.post('/api/entries/:id/annotations', () =>
        apiErrorResponse(422, 'validation_error', 'Some fields are invalid.', {
          fields: { color: 'Pick one of the note colors.', end_ms: 'Too late.' },
        }),
      ),
    );
    const { start, end, body } = setup();

    await userEvent.type(start, '1:00');
    await userEvent.type(end, '1:10');
    await userEvent.type(body, 'x');
    await userEvent.click(screen.getByRole('button', { name: 'Add note' }));

    expect(await screen.findByText('Pick one of the note colors.')).toBeInTheDocument();
    expect(end).toHaveAccessibleDescription(expect.stringContaining('Too late.'));
    expect(screen.getByRole('group', { name: 'Color' })).toHaveAccessibleDescription(
      'Pick one of the note colors.',
    );
    expect(end).toHaveFocus();

    await userEvent.click(screen.getByRole('radio', { name: 'Green' }));
    expect(screen.getByRole('group', { name: 'Color' })).not.toHaveAccessibleDescription();
  });

  it('explains when the song is full of notes', async () => {
    const { start, body, onSaved, entry } = setup();
    for (let index = 0; index < 200; index += 1) {
      fakeApi.seedAnnotation(entry.id, { start_ms: index * 1000 });
    }

    await userEvent.type(start, '1:00');
    await userEvent.type(body, 'one more');
    await userEvent.click(screen.getByRole('button', { name: 'Add note' }));

    expect(await screen.findByText(ANNOTATION_LIMIT_MESSAGE)).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('describes other failures', async () => {
    server.use(
      http.post('/api/entries/:id/annotations', () =>
        apiErrorResponse(500, 'internal_error', 'Boom.'),
      ),
    );
    const { start, body } = setup();

    await userEvent.type(start, '1:00');
    await userEvent.type(body, 'x');
    await userEvent.click(screen.getByRole('button', { name: 'Add note' }));

    expect(await screen.findByText(SERVER_ERROR_MESSAGE)).toBeInTheDocument();
  });

  it('edits only the changed fields; clearing the end sends end_ms: null', async () => {
    const user = fakeApi.seedUser();
    const entry = fakeApi.seedEntry(user.id);
    const saved = fakeApi.seedAnnotation(entry.id, {
      start_ms: 60_000,
      end_ms: 75_000,
      body: 'old',
      color: 'blue',
    });
    const onSaved = vi.fn();
    renderWithProviders(
      <AnnotationForm entryId={entry.id} annotation={saved} onSaved={onSaved} onCancel={vi.fn()} />,
      { user },
    );
    const end = screen.getByRole('textbox', { name: 'End (optional)' });
    expect(screen.getByRole('textbox', { name: 'Note' })).toHaveFocus();
    expect(screen.getByRole('form', { name: 'Edit note' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Blue' })).toBeChecked();

    await userEvent.clear(end);
    await userEvent.click(screen.getByRole('button', { name: 'Save note' }));

    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: saved.id, end_ms: null }));
    });
    expect(fakeApi.requests.at(-1)?.method).toBe('PATCH');
    expect(fakeApi.getEntry(entry.id)?.annotations[0]).toMatchObject({ end_ms: null, body: 'old' });
  });

  it('saves nothing when nothing changed', async () => {
    const user = fakeApi.seedUser();
    const entry = fakeApi.seedEntry(user.id);
    const saved = fakeApi.seedAnnotation(entry.id);
    const onSaved = vi.fn();
    renderWithProviders(
      <AnnotationForm entryId={entry.id} annotation={saved} onSaved={onSaved} onCancel={vi.fn()} />,
      { user },
    );

    await userEvent.click(screen.getByRole('button', { name: 'Save note' }));

    expect(onSaved).toHaveBeenCalledWith(saved);
    expect(annotationRequests()).toHaveLength(0);
  });

  it('maps errors when editing too', async () => {
    server.use(
      http.patch('/api/entries/:id/annotations/:annotationId', () =>
        apiErrorResponse(422, 'validation_error', 'Some fields are invalid.', {
          fields: { body: 'Too long.' },
        }),
      ),
    );
    const user = fakeApi.seedUser();
    const entry = fakeApi.seedEntry(user.id);
    const saved = fakeApi.seedAnnotation(entry.id);
    renderWithProviders(
      <AnnotationForm entryId={entry.id} annotation={saved} onSaved={vi.fn()} onCancel={vi.fn()} />,
      { user },
    );
    const body = screen.getByRole('textbox', { name: 'Note' });

    await userEvent.type(body, '!');
    await userEvent.click(screen.getByRole('button', { name: 'Save note' }));

    await waitFor(() => {
      expect(body).toHaveAccessibleDescription(expect.stringContaining('Too long.'));
    });
  });

  it('cancels', async () => {
    const { onCancel } = setup();

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
