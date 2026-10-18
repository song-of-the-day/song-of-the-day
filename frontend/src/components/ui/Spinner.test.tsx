import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Spinner } from './Spinner';

describe('Spinner', () => {
  it('announces its label', () => {
    render(<Spinner label="Loading songs…" size="lg" />);

    expect(screen.getByRole('status')).toHaveTextContent('Loading songs…');
  });

  it('has a default label and a decorative mode', () => {
    const { container, rerender } = render(<Spinner />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading…');

    rerender(<Spinner decorative />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });
});
