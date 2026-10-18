import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Button } from './Button';
import { buttonClassName, iconButtonClassName } from './buttonStyles';

describe('Button', () => {
  it('is a non-submitting button by default and handles clicks', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save</Button>);

    const button = screen.getByRole('button', { name: 'Save' });
    expect(button).toHaveAttribute('type', 'button');
    await userEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('applies the variant, size and width', () => {
    render(
      <Button variant="danger" size="lg" fullWidth className="mt-2">
        Delete
      </Button>,
    );

    const button = screen.getByRole('button', { name: 'Delete' });
    expect(button).toHaveClass('bg-fg', 'text-surface', 'min-h-12', 'w-full', 'mt-2', 'y2k-pill');
  });

  it('renders an icon before the label', () => {
    render(<Button icon={<svg data-testid="icon" />}>Log</Button>);

    expect(screen.getByRole('button', { name: 'Log' })).toContainElement(
      screen.getByTestId('icon'),
    );
  });

  it('stays focusable but ignores clicks and submits while loading', async () => {
    const onClick = vi.fn();
    const onSubmit = vi.fn((event: React.SubmitEvent) => {
      event.preventDefault();
    });
    render(
      <form onSubmit={onSubmit}>
        <Button type="submit" loading onClick={onClick} icon={<svg data-testid="icon" />}>
          Log in
        </Button>
      </form>,
    );

    const button = screen.getByRole('button', { name: 'Log in' });
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).toBeEnabled();
    expect(screen.queryByTestId('icon')).not.toBeInTheDocument();

    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(button).toHaveFocus();
  });

  it('forwards its ref and native props', () => {
    const ref = createRef<HTMLButtonElement>();
    render(
      <Button ref={ref} disabled aria-describedby="hint">
        Go
      </Button>,
    );

    expect(ref.current).toBe(screen.getByRole('button', { name: 'Go' }));
    expect(ref.current).toBeDisabled();
    expect(ref.current).toHaveAttribute('aria-describedby', 'hint');
  });
});

describe('button class names', () => {
  it('defaults to a medium primary pill', () => {
    expect(buttonClassName()).toContain('bg-accent');
    expect(buttonClassName()).toContain('min-h-11');
    expect(buttonClassName({ variant: 'ghost', size: 'sm' })).toContain('bg-transparent');
  });

  it('builds round icon buttons', () => {
    expect(iconButtonClassName()).toContain('size-11');
    expect(iconButtonClassName({ size: 'sm', variant: 'secondary', className: 'x' })).toContain(
      'size-9',
    );
  });
});
