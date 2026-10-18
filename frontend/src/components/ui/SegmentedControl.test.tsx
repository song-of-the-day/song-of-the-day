import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { SegmentedControl } from './SegmentedControl';

type View = 'board' | 'calendar' | 'list';

const OPTIONS = [
  { value: 'board', label: 'Board', icon: <svg data-testid="board-icon" /> },
  { value: 'calendar', label: 'Calendar' },
  { value: 'list', label: 'List' },
] as const;

function Harness({ onChange }: { onChange?: (value: View) => void }) {
  const [value, setValue] = useState<View>('board');
  return (
    <SegmentedControl<View>
      label="View"
      options={OPTIONS}
      value={value}
      size="sm"
      onChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
    />
  );
}

describe('SegmentedControl', () => {
  it('is a labelled radio group with the value checked', () => {
    render(<Harness />);

    expect(screen.getByRole('radiogroup', { name: 'View' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Board' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Calendar' })).not.toBeChecked();
    expect(screen.getByTestId('board-icon')).toBeInTheDocument();
  });

  it('selects an option on click', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    await userEvent.click(screen.getByText('Calendar'));
    expect(onChange).toHaveBeenCalledWith('calendar');
    expect(screen.getByRole('radio', { name: 'Calendar' })).toBeChecked();
  });

  it('moves the selection with the arrow keys', async () => {
    const onChange = vi.fn<(value: View) => void>();
    render(<Harness onChange={onChange} />);

    await userEvent.tab();
    expect(screen.getByRole('radio', { name: 'Board' })).toHaveFocus();

    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: 'Calendar' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Calendar' })).toHaveFocus();

    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('radio', { name: 'List' })).toBeChecked();

    await userEvent.keyboard('{ArrowLeft}');
    expect(screen.getByRole('radio', { name: 'Calendar' })).toBeChecked();
    expect(onChange.mock.calls.map(([value]) => value)).toEqual(['calendar', 'list', 'calendar']);
  });

  it('is a single tab stop', async () => {
    render(
      <>
        <Harness />
        <button type="button">After</button>
      </>,
    );

    await userEvent.tab();
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'After' })).toHaveFocus();
  });
});
