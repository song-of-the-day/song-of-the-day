import type { ComponentPropsWithRef } from 'react';

import { iconButtonClassName, type ButtonSize, type ButtonVariant } from './buttonStyles';

export interface IconButtonProps extends Omit<
  ComponentPropsWithRef<'button'>,
  'aria-label' | 'title'
> {
  /** The accessible name, also shown as a tooltip. Required: the button has no visible text. */
  label: string;
  variant?: ButtonVariant;
  size?: Exclude<ButtonSize, 'lg'>;
}

/**
 * A round, icon-only button. Pass the icon as children (lucide icons are hidden from assistive
 * technology by default).
 */
export function IconButton({
  label,
  variant = 'ghost',
  size = 'md',
  type = 'button',
  className,
  children,
  ...props
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={iconButtonClassName({ variant, size, className })}
      {...props}
    >
      {children}
    </button>
  );
}
