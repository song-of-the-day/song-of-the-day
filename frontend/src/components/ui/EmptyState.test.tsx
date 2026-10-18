import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { EmptyState } from './EmptyState';

describe('EmptyState', () => {
  it('shows a heading, description and action on a surface window', () => {
    const { container } = render(
      <EmptyState
        title="no songs yet ✦"
        description="Your board starts with today's song."
        action={<button type="button">Log today&apos;s song</button>}
      />,
    );

    expect(screen.getByRole('heading', { level: 2, name: 'no songs yet ✦' })).toBeInTheDocument();
    expect(screen.getByText("Your board starts with today's song.")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: "Log today's song" })).toBeInTheDocument();
    expect(container.firstChild).toHaveClass('y2k-window');
  });

  it('supports a level-3 heading without extras', () => {
    render(<EmptyState title="nothing here" headingLevel={3} />);

    expect(screen.getByRole('heading', { level: 3, name: 'nothing here' })).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
