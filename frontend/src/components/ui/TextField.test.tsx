import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { TextField } from './TextField';

describe('TextField', () => {
  it('labels the input and stays valid without an error', () => {
    render(<TextField label="Email" type="email" />);

    const input = screen.getByRole('textbox', { name: 'Email' });
    expect(input).toHaveAttribute('type', 'email');
    expect(input).not.toHaveAttribute('aria-invalid');
    expect(input).not.toHaveAttribute('aria-describedby');
  });

  it('describes the input with its hint and error and marks it invalid', () => {
    render(
      <TextField
        label="Password"
        id="pw"
        hint="Use 8–128 characters."
        error="Too short."
        aria-describedby="extra"
      />,
    );

    const input = screen.getByRole('textbox', { name: 'Password' });
    expect(input).toHaveAttribute('id', 'pw');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAttribute('aria-describedby', 'extra pw-hint pw-error');
    expect(input).toHaveAccessibleDescription('Use 8–128 characters. Too short.');
  });

  it('forwards its ref and renders a trailing element', () => {
    const ref = createRef<HTMLInputElement>();
    render(<TextField label="Name" ref={ref} trailing={<button type="button">Clear</button>} />);

    expect(ref.current).toBe(screen.getByRole('textbox', { name: 'Name' }));
    expect(ref.current).toHaveClass('pr-12');
    expect(screen.getByRole('button', { name: 'Clear' })).toBeInTheDocument();
  });

  it('passes typing through to onChange', async () => {
    const onChange = vi.fn();
    render(<TextField label="Name" onChange={onChange} />);

    await userEvent.type(screen.getByRole('textbox', { name: 'Name' }), 'Ada');
    expect(onChange).toHaveBeenCalledTimes(3);
  });
});
