import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AUTH_TAGLINE, AuthLayout } from './AuthLayout';

describe('AuthLayout', () => {
  it('frames the page in a window with the wordmark and tagline', () => {
    render(
      <AuthLayout title="log in" documentTitle="Log in">
        <form aria-label="Log in form" />
      </AuthLayout>,
    );

    const main = screen.getByRole('main');
    expect(screen.getByRole('heading', { level: 1, name: 'log in' })).toBeInTheDocument();
    expect(main).toHaveTextContent('song of the day');
    expect(main).toHaveTextContent(AUTH_TAGLINE);
    expect(screen.getByRole('form', { name: 'Log in form' })).toBeInTheDocument();
    expect(document.title).toBe('Log in · song of the day');
  });

  it('uses the default theme and backdrop pattern', () => {
    const { container } = render(
      <AuthLayout title="sign up" documentTitle="Sign up">
        <p>Form</p>
      </AuthLayout>,
    );

    expect(container.ownerDocument.querySelector('.sotd-backdrop')).toHaveAttribute(
      'data-pattern',
      'grid',
    );
    expect(document.documentElement.style).toHaveLength(0);
  });
});
