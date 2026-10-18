import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Alert, FormError } from './Alert';

describe('Alert and FormError', () => {
  it('announces errors assertively and other tones politely', () => {
    render(
      <>
        <Alert tone="error">Wrong password.</Alert>
        <Alert tone="success" title="Saved">
          Your theme is live.
        </Alert>
        <Alert>Heads up.</Alert>
      </>,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Wrong password.');
    const statuses = screen.getAllByRole('status');
    expect(statuses[0]).toHaveTextContent('SavedYour theme is live.');
    expect(statuses[1]).toHaveTextContent('Heads up.');
  });

  it('renders a form error only when there is a message', () => {
    const { rerender } = render(<FormError message={null} />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    rerender(<FormError message="" />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    rerender(<FormError message="Too many attempts." />);
    expect(screen.getByRole('alert')).toHaveTextContent('Too many attempts.');
  });
});
