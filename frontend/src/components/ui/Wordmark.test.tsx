import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Wordmark } from './Wordmark';

describe('Wordmark', () => {
  it('reads "song of the day" with a decorative sparkle', () => {
    const { container } = render(<Wordmark size="lg" />);

    const mark = container.querySelector('p');
    expect(mark).toHaveClass('font-heading');
    expect(mark).toHaveTextContent('song of the day ✦');
    expect(screen.getByText('✦')).toHaveAttribute('aria-hidden', 'true');
  });

  it('can render inline', () => {
    const { container } = render(<Wordmark as="span" size="sm" />);

    expect(container.querySelector('span.font-heading')).toBeInTheDocument();
  });
});
