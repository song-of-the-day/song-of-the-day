import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { PasswordField } from './PasswordField';

describe('PasswordField', () => {
  it('toggles visibility with a pressed-state button', async () => {
    render(<PasswordField label="Password" defaultValue="secret" />);

    const input = screen.getByLabelText('Password');
    expect(input).toHaveAttribute('type', 'password');

    const toggle = screen.getByRole('button', { name: 'Show password' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(toggle);

    expect(input).toHaveAttribute('type', 'text');
    expect(toggle).toHaveAccessibleName('Show password');
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(toggle);
    expect(input).toHaveAttribute('type', 'password');
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
  });
});
