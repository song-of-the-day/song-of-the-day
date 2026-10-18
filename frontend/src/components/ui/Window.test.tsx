import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Window } from './Window';

describe('Window', () => {
  it('is a region named by its heading, with decorative dots', () => {
    const { container } = render(
      <Window title="sotd.exe" actions={<button type="button">Close</button>}>
        <p>Body</p>
      </Window>,
    );

    const region = screen.getByRole('region', { name: 'sotd.exe' });
    expect(screen.getByRole('heading', { level: 2, name: 'sotd.exe' })).toBeInTheDocument();
    expect(region).toHaveClass('y2k-window');
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
    expect(container.querySelector('.y2k-dots')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText('Body').parentElement).toHaveClass('p-4');
  });

  it('supports a heading level and replaces the body padding', () => {
    render(
      <Window title="log in" headingLevel={1} bodyClassName="p-8">
        <p>Body</p>
      </Window>,
    );

    expect(screen.getByRole('heading', { level: 1, name: 'log in' })).toBeInTheDocument();
    expect(screen.getByText('Body').parentElement).toHaveClass('p-8');
    expect(screen.getByText('Body').parentElement).not.toHaveClass('p-4');
  });
});
