import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { makeAnnotation } from '@/test/fixtures';

import {
  AnnotationTimeline,
  APPROXIMATE_HINT,
  DRAG_HINT,
  type AnnotationTimelineProps,
} from './AnnotationTimeline';

const LENGTH_MS = 200_000;
/** The track is 400 px wide from x = 100, so 2 px is one second. */
const TRACK_RECT = { left: 100, width: 400 };

const chorus = makeAnnotation({ id: 1, start_ms: 60_000, end_ms: 90_000, body: 'chorus\nhits' });
const drop = makeAnnotation({ id: 2, start_ms: 20_000, end_ms: null, body: 'the drop' });

function setup(overrides: Partial<AnnotationTimelineProps> = {}) {
  const props: AnnotationTimelineProps = {
    annotations: [chorus, drop],
    lengthMs: LENGTH_MS,
    draggable: true,
    playheadMs: null,
    playingIds: new Set(),
    selectedId: null,
    onSelectNote: vi.fn(),
    onSelectRange: vi.fn(),
    ...overrides,
  };
  const view = render(<AnnotationTimeline {...props} />);
  const surface = view.container.querySelector<HTMLElement>('[data-drag-surface]');
  if (surface === null) {
    throw new Error('No drag surface');
  }
  vi.spyOn(surface, 'getBoundingClientRect').mockReturnValue({
    ...TRACK_RECT,
    x: TRACK_RECT.left,
    y: 0,
    top: 0,
    right: TRACK_RECT.left + TRACK_RECT.width,
    bottom: 32,
    height: 32,
    toJSON: () => ({}),
  });
  return { ...view, props, surface };
}

function markers(): HTMLElement[] {
  return screen.getAllByRole('button');
}

function drag(surface: HTMLElement, fromX: number, toX: number, pointerId = 1) {
  fireEvent.pointerDown(surface, { pointerId, button: 0, clientX: fromX });
  fireEvent.pointerMove(surface, { pointerId, clientX: (fromX + toX) / 2 });
  fireEvent.pointerMove(surface, { pointerId, clientX: toX });
  fireEvent.pointerUp(surface, { pointerId, clientX: toX });
}

describe('AnnotationTimeline', () => {
  it('shows the notes in time order, named by time and text', () => {
    setup();

    expect(screen.getByRole('toolbar', { name: 'Notes on the timeline' })).toBeInTheDocument();
    expect(markers().map((marker) => marker.getAttribute('aria-label'))).toEqual([
      '0:20: the drop',
      '1:00–1:30: chorus hits',
    ]);
  });

  it('draws ranges from start to end and points as pins', () => {
    setup();
    const [pin, rangeMarker] = markers() as [HTMLElement, HTMLElement];

    expect(rangeMarker.style.left).toBe('30%');
    expect(rangeMarker.style.width).toBe('15%');
    expect(rangeMarker).toHaveClass('bg-(--y2k-note-color)/70', 'border-fg');
    expect(pin.style.left).toBe('10%');
    expect(pin.style.width).toBe('');
    expect(pin).toHaveClass('rounded-full', 'bg-(--y2k-note-color)', 'border-fg');
  });

  it("shows the note's text on hover and focus", () => {
    setup();

    // The tooltip repeats the accessible name, so it is hidden from assistive technology.
    const tooltip = markers()[1]?.querySelector('[aria-hidden="true"]');
    expect(tooltip).toHaveTextContent('1:00–1:30chorus hits');
    expect(tooltip).toHaveClass('group-hover:block', 'group-focus-visible:block');
  });

  it('truncates long text in the name', () => {
    setup({ annotations: [makeAnnotation({ start_ms: 0, end_ms: null, body: 'a'.repeat(100) })] });

    expect(markers()[0]).toHaveAccessibleName(`0:00: ${'a'.repeat(79)}…`);
  });

  it('selects a clicked note', async () => {
    const { props } = setup();

    await userEvent.click(screen.getByRole('button', { name: /chorus/ }));

    expect(props.onSelectNote).toHaveBeenCalledWith(chorus);
  });

  it('marks the selected and the playing notes', () => {
    setup({ selectedId: 2, playingIds: new Set([1]) });

    expect(screen.getByRole('button', { name: /chorus/ })).toHaveAttribute('aria-current', 'time');
    expect(screen.getByRole('button', { name: /the drop/ })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('button', { name: /the drop/ })).toHaveClass('outline-dashed');
  });

  it('moves between notes with the arrow keys as a single tab stop', async () => {
    setup({
      annotations: [chorus, drop, makeAnnotation({ id: 3, start_ms: 150_000, end_ms: null })],
    });
    const [first, second, third] = markers() as [HTMLElement, HTMLElement, HTMLElement];

    await userEvent.tab();
    expect(first).toHaveFocus();
    expect(second).toHaveAttribute('tabindex', '-1');

    await userEvent.keyboard('{ArrowRight}');
    expect(second).toHaveFocus();
    expect(second).toHaveAttribute('tabindex', '0');
    await userEvent.keyboard('{End}');
    expect(third).toHaveFocus();
    await userEvent.keyboard('{ArrowRight}');
    expect(third).toHaveFocus();
    await userEvent.keyboard('{Home}');
    expect(first).toHaveFocus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(first).toHaveFocus();
    await userEvent.keyboard('a');
    expect(first).toHaveFocus();
  });

  it('renders no note controls without notes', () => {
    setup({ annotations: [] });

    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();
  });

  it('shows the playhead only with a ready player', () => {
    const { container, rerender, props } = setup();
    expect(container.querySelector('[data-playhead]')).toBeNull();

    rerender(<AnnotationTimeline {...props} playheadMs={50_000} />);

    expect(container.querySelector<HTMLElement>('[data-playhead]')?.style.left).toBe('25%');
  });

  it('labels the track with nice ticks', () => {
    const { container } = setup();

    const labels = container.querySelectorAll('.tabular-nums.text-muted > span');
    expect([...labels].map((label) => label.textContent)).toEqual(['0:00', '1:00', '2:00', '3:00']);
  });

  it('turns a drag across the track into a range, in whole seconds', () => {
    const { props, surface, container } = setup();

    fireEvent.pointerDown(surface, { pointerId: 1, button: 0, clientX: 300 });
    fireEvent.pointerMove(surface, { pointerId: 1, clientX: 220 });
    expect(container).toHaveTextContent('1:00–1:40');
    fireEvent.pointerUp(surface, { pointerId: 1, clientX: 200 });

    expect(props.onSelectRange).toHaveBeenCalledWith(50_000, 100_000);
    expect(container).not.toHaveTextContent('0:50–1:40');
    expect(screen.getByText(DRAG_HINT)).toBeInTheDocument();
  });

  it('ignores clicks, short drags, other buttons and other pointers', () => {
    const { props, surface } = setup();

    drag(surface, 300, 300.8);
    fireEvent.pointerDown(surface, { pointerId: 1, button: 2, clientX: 100 });
    fireEvent.pointerUp(surface, { pointerId: 1, clientX: 300 });
    fireEvent.pointerDown(surface, { pointerId: 1, button: 0, clientX: 100 });
    fireEvent.pointerMove(surface, { pointerId: 2, clientX: 200 });
    fireEvent.pointerUp(surface, { pointerId: 2, clientX: 300 });
    fireEvent.pointerCancel(surface, { pointerId: 1 });
    fireEvent.pointerUp(surface, { pointerId: 1, clientX: 300 });

    expect(props.onSelectRange).not.toHaveBeenCalled();
  });

  it('disables dragging when the length is only approximate', () => {
    const { props, surface } = setup({ draggable: false });

    drag(surface, 120, 400);

    expect(props.onSelectRange).not.toHaveBeenCalled();
    expect(surface).not.toHaveClass('cursor-crosshair');
    expect(screen.getByText(APPROXIMATE_HINT)).toBeInTheDocument();
  });
});
