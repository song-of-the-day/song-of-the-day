import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';

import { ProfileDock } from './ProfileDock';

describe('ProfileDock', () => {
  it('runs the owner actions from a labelled footer landmark', async () => {
    const onCustomize = vi.fn();
    const onAccount = vi.fn();
    renderWithProviders(<ProfileDock onCustomize={onCustomize} onAccount={onAccount} />);

    const dock = within(screen.getByRole('contentinfo', { name: 'Settings' }));
    await userEvent.click(dock.getByRole('button', { name: 'Customize' }));
    expect(onCustomize).toHaveBeenCalledOnce();
    await userEvent.click(dock.getByRole('button', { name: 'Account' }));
    expect(onAccount).toHaveBeenCalledOnce();
  });
});
