import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FIXED_NOW } from '@/test/fixtures';

import { DateStamp } from './DateStamp';

function stampOf(container: HTMLElement): HTMLElement {
  const time = container.querySelector('time');
  if (time === null) {
    throw new Error('DateStamp not rendered');
  }
  return time;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(FIXED_NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('DateStamp', () => {
  it('shows month and day for the current year, with the full date for assistive technology', () => {
    const { container } = render(<DateStamp date="2026-10-11" />);

    const time = stampOf(container);
    expect(time).toHaveAttribute('dateTime', '2026-10-11');
    expect(time).toHaveAttribute('title', 'Sunday, October 11, 2026');
    expect(time).toHaveClass('y2k-stamp');
    expect(screen.getByText('OCT 11')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText('Sunday, October 11, 2026')).toHaveClass('sr-only');
  });

  it('adds the year for dates in other years', () => {
    const { container } = render(<DateStamp date="2025-03-03" />);

    expect(screen.getByText('MAR 3 2025')).toHaveAttribute('aria-hidden', 'true');
    expect(stampOf(container)).toHaveAttribute('title', 'Monday, March 3, 2025');
  });

  it('drops the year once that year becomes the current one', () => {
    vi.setSystemTime(new Date('2026-12-31T12:00:00Z'));
    render(<DateStamp date="2027-01-01" />);
    expect(screen.getByText('JAN 1 2027')).toBeInTheDocument();

    vi.setSystemTime(new Date('2027-01-01T12:00:00Z'));
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });

    expect(screen.getByText('JAN 1')).toBeInTheDocument();
  });

  it('merges the given classes', () => {
    const { container } = render(<DateStamp date="2026-10-11" className="rotate-0" />);

    expect(stampOf(container)).toHaveClass('y2k-stamp', 'rotate-0');
  });

  it('shows a malformed date as given, without a machine-readable value', () => {
    const { container } = render(<DateStamp date="2026-02-30" />);

    const time = stampOf(container);
    expect(time).toHaveTextContent('2026-02-30');
    expect(time).not.toHaveAttribute('dateTime');
    expect(time).not.toHaveAttribute('title');
  });
});
