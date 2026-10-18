import type { ComponentPropsWithRef, MouseEvent, ReactNode } from 'react';

import { buttonClassName, type ButtonSize, type ButtonVariant } from './buttonStyles';
import { Spinner } from './Spinner';

export interface ButtonProps extends ComponentPropsWithRef<'button'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  /**
   * Shows a spinner and ignores clicks while an action runs. The button stays focusable (it is
   * `aria-disabled`, not `disabled`), so keyboard focus is not lost mid-submit.
   */
  loading?: boolean;
  /** An icon before the label; replaced by the spinner while loading. */
  icon?: ReactNode;
}

/**
 * A glossy pill button. Defaults to `type="button"` so it never submits a form by accident.
 */
export function Button({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  loading = false,
  icon,
  type = 'button',
  className,
  children,
  onClick,
  ...props
}: ButtonProps) {
  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    if (loading) {
      event.preventDefault();
      return;
    }
    onClick?.(event);
  }

  return (
    <button
      type={type}
      className={buttonClassName({ variant, size, fullWidth, className })}
      aria-busy={loading || undefined}
      aria-disabled={loading || undefined}
      onClick={handleClick}
      {...props}
    >
      {loading ? <Spinner size="sm" decorative className="text-current" /> : icon}
      {children}
    </button>
  );
}
