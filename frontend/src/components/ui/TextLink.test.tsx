import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { describe, expect, it } from 'vitest';

import { TextLink } from './TextLink';

describe('TextLink', () => {
  it('is an underlined in-app link', async () => {
    const router = createMemoryRouter(
      [
        { path: '/', element: <TextLink to="/signup">Create an account</TextLink> },
        { path: '/signup', element: <p>Sign up page</p> },
      ],
      { initialEntries: ['/'] },
    );
    render(<RouterProvider router={router} />);

    const link = screen.getByRole('link', { name: 'Create an account' });
    expect(link).toHaveClass('underline');
    await userEvent.click(link);
    expect(screen.getByText('Sign up page')).toBeInTheDocument();
  });
});
