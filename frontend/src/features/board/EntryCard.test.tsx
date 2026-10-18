import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CardStyle } from '@/lib/theme';
import { FIXED_NOW, makeEntry } from '@/test/fixtures';

import { EntryCard } from './EntryCard';

const NAME = 'Open Gosh by Jamie xx, Sunday, October 11, 2026';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(FIXED_NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

function renderCard(cardStyle: CardStyle, overrides: Parameters<typeof makeEntry>[0] = {}) {
  const entry = makeEntry({ note: 'the build at 2:30', annotation_count: 3, ...overrides });
  const onOpen = vi.fn();
  render(<EntryCard entry={entry} cardStyle={cardStyle} onOpen={onOpen} />);
  return { entry, onOpen, card: screen.getByRole('button', { name: NAME }) };
}

describe('EntryCard', () => {
  it('opens its entry', async () => {
    const { entry, onOpen, card } = renderCard('window');

    await userEvent.click(card);

    expect(onOpen).toHaveBeenCalledWith(entry.id);
  });

  it('renders a window with a date-stamped title bar, the note and the notes count', () => {
    const { card } = renderCard('window');

    expect(card).toHaveClass('y2k-window');
    expect(card.querySelector('.y2k-titlebar')).toContainElement(card.querySelector('time'));
    expect(card.querySelector('.y2k-dots')).toHaveAttribute('aria-hidden', 'true');
    expect(within(card).getByText('OCT 11')).toBeInTheDocument();
    expect(within(card).getByText('Gosh')).toHaveClass('truncate');
    expect(within(card).getByText('Jamie xx')).toHaveClass('truncate');
    expect(within(card).getByText('the build at 2:30')).toHaveClass('line-clamp-2');
    expect(card).toHaveAccessibleDescription('3 notes the build at 2:30');
    expect(within(card).getByRole('img', { name: 'Gosh by Jamie xx artwork' })).toBeInTheDocument();
  });

  it('leaves out the note excerpt and the badge when there are none', () => {
    const { card } = renderCard('window', { note: null, annotation_count: 0 });

    expect(card).not.toHaveAttribute('aria-describedby');
    expect(within(card).queryByText(/notes?$/)).not.toBeInTheDocument();
  });

  it('renders a polaroid with a caption under the art', () => {
    const { card } = renderCard('polaroid');

    expect(card).toHaveClass('y2k-polaroid');
    const caption = card.querySelector('.y2k-polaroid-caption');
    expect(caption).toHaveTextContent('GoshJamie xx');
    expect(caption).toContainElement(card.querySelector('time'));
    expect(within(card).queryByText('the build at 2:30')).not.toBeInTheDocument();
    expect(card).not.toHaveAttribute('aria-describedby');
  });

  it('renders a minimal card with art and text', () => {
    const { card } = renderCard('minimal', { artwork_url: null });

    expect(card).toHaveClass('border', 'border-line', 'bg-surface');
    expect(card).not.toHaveClass('y2k-window');
    expect(card.querySelector('[data-cd-placeholder]')).not.toBeNull();
    expect(within(card).getByText('Gosh')).toBeInTheDocument();
    expect(card.querySelector('time')).toHaveAttribute('dateTime', '2026-10-11');
  });
});
