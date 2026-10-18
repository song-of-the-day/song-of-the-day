import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useFocusOnMount } from './useFocusOnMount';

function Panel() {
  const ref = useFocusOnMount<HTMLDivElement>();
  return (
    <div ref={ref} tabIndex={-1}>
      Check your inbox
    </div>
  );
}

describe('useFocusOnMount', () => {
  it('focuses the element after it mounts', () => {
    render(<Panel />);

    expect(screen.getByText('Check your inbox')).toHaveFocus();
  });
});
