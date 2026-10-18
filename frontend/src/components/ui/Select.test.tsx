import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Select } from './Select';

describe('Select', () => {
  it('is a labelled native select with hint and error', async () => {
    const onChange = vi.fn();
    render(
      <Select label="Font" hint="Used for headings." error="Pick one." onChange={onChange}>
        <option value="inter">Inter</option>
        <option value="vt323">VT323</option>
      </Select>,
    );

    const select = screen.getByRole('combobox', { name: 'Font' });
    expect(select).toHaveAttribute('aria-invalid', 'true');
    expect(select).toHaveAccessibleDescription('Used for headings. Pick one.');
    await userEvent.selectOptions(select, 'vt323');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(select).toHaveValue('vt323');
  });

  it('is valid and undescribed without a hint or error', () => {
    render(
      <Select label="View" defaultValue="board">
        <option value="board">Board</option>
      </Select>,
    );

    const select = screen.getByRole('combobox', { name: 'View' });
    expect(select).not.toHaveAttribute('aria-invalid');
    expect(select).not.toHaveAttribute('aria-describedby');
  });
});
