import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ExternalLink } from './ExternalLink';

describe('ExternalLink', () => {
  it('opens a new tab safely and says so', () => {
    render(<ExternalLink href="https://example.com/">Example</ExternalLink>);

    const link = screen.getByRole('link', { name: 'Example (opens in a new tab)' });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link).toHaveClass('underline');
    expect(link).toHaveTextContent('Example ↗');
  });

  it('drops the text styling and arrow when plain', () => {
    render(
      <ExternalLink plain href="https://example.com/" className="inline-flex">
        Example
      </ExternalLink>,
    );

    const link = screen.getByRole('link', { name: 'Example (opens in a new tab)' });
    expect(link).toHaveClass('inline-flex');
    expect(link).not.toHaveClass('underline');
    expect(link).not.toHaveTextContent('↗');
  });
});
