import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CenteredPage } from './CenteredPage';

describe('CenteredPage', () => {
  it('renders its content in a main landmark over the default backdrop', () => {
    const { container } = render(
      <CenteredPage>
        <p>Hello</p>
      </CenteredPage>,
    );

    expect(screen.getByRole('main')).toHaveTextContent('Hello');
    expect(container.querySelector('.sotd-backdrop')).toHaveAttribute('data-pattern', 'grid');
  });
});
