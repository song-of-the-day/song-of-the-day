import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { Checkbox } from './Checkbox';

describe('Checkbox', () => {
  it('is a labelled checkbox that toggles', async () => {
    render(<Checkbox label="Keep me logged in" defaultChecked />);

    const checkbox = screen.getByRole('checkbox', { name: 'Keep me logged in' });
    expect(checkbox).toBeChecked();
    await userEvent.click(screen.getByText('Keep me logged in'));
    expect(checkbox).not.toBeChecked();
    expect(checkbox).not.toHaveAttribute('aria-describedby');
  });

  it('describes itself with a hint and error', () => {
    render(<Checkbox label="Agree" hint="Required to continue." error="Please agree." />);

    const checkbox = screen.getByRole('checkbox', { name: 'Agree' });
    expect(checkbox).toHaveAttribute('aria-invalid', 'true');
    expect(checkbox).toHaveAccessibleDescription('Required to continue. Please agree.');
  });
});
