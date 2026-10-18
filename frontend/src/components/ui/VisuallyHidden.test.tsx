import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { VisuallyHidden } from './VisuallyHidden';

describe('VisuallyHidden', () => {
  it('keeps text available to assistive technology', () => {
    render(
      <button type="button">
        <svg />
        <VisuallyHidden>Play</VisuallyHidden>
      </button>,
    );

    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
    expect(screen.getByText('Play')).toHaveClass('sr-only');
  });
});
