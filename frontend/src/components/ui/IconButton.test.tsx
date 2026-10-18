import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { IconButton } from './IconButton';

describe('IconButton', () => {
  it('uses its label as the accessible name and tooltip', async () => {
    const onClick = vi.fn();
    render(
      <IconButton label="Close" onClick={onClick}>
        <svg />
      </IconButton>,
    );

    const button = screen.getByRole('button', { name: 'Close' });
    expect(button).toHaveAttribute('title', 'Close');
    expect(button).toHaveAttribute('type', 'button');
    await userEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
