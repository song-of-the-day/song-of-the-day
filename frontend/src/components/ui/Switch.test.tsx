import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Switch } from './Switch';

function Controlled() {
  const [checked, setChecked] = useState(false);
  return (
    <Switch
      label="Auto-play"
      hint="Plays on open."
      checked={checked}
      onCheckedChange={setChecked}
    />
  );
}

describe('Switch', () => {
  it('is a labelled switch that toggles by click and keyboard', async () => {
    render(<Controlled />);
    const toggle = screen.getByRole('switch', { name: 'Auto-play' });

    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(toggle).toHaveAccessibleDescription('Plays on open.');

    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'true');

    toggle.focus();
    await userEvent.keyboard(' ');
    expect(toggle).toHaveAttribute('aria-checked', 'false');
  });

  it('does nothing while disabled', async () => {
    const onCheckedChange = vi.fn();
    render(<Switch label="Auto-play" checked disabled onCheckedChange={onCheckedChange} />);

    await userEvent.click(screen.getByRole('switch', { name: 'Auto-play' }));

    expect(onCheckedChange).not.toHaveBeenCalled();
    expect(screen.getByRole('switch')).not.toHaveAccessibleDescription();
  });
});
