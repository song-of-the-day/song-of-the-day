/**
 * Button class names, shared by {@link Button}, {@link IconButton} and links styled as buttons
 * (`<Link className={buttonClassName({ variant: 'secondary' })}>`).
 */
import { cn } from '@/lib/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

const BASE =
  'inline-flex items-center justify-center gap-2 border font-body font-semibold whitespace-nowrap select-none motion-safe:transition-[filter,background-color,translate] motion-safe:duration-150 disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-not-allowed';

/*
 * Primary uses the accent; danger inverts text and surface (the theme has no "danger" color and
 * text/surface contrast is guaranteed). The label, not the color, carries the meaning.
 */
const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'y2k-pill border-accent bg-accent text-accent-contrast hover:brightness-110 active:brightness-95',
  secondary: 'y2k-pill border-muted bg-surface text-fg hover:bg-fg/5 active:bg-fg/10',
  ghost: 'rounded-full border-transparent bg-transparent text-fg hover:bg-fg/10 active:bg-fg/15',
  danger: 'y2k-pill border-fg bg-fg text-surface hover:brightness-125 active:brightness-95',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'min-h-9 px-3.5 text-sm',
  md: 'min-h-11 px-5 text-sm',
  lg: 'min-h-12 px-6 text-base',
};

const ICON_SIZES: Record<Exclude<ButtonSize, 'lg'>, string> = {
  sm: 'size-9',
  md: 'size-11',
};

export interface ButtonStyleOptions {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Stretch to the container's width. */
  fullWidth?: boolean;
  className?: string;
}

/**
 * Builds a button's class list.
 *
 * @param options - Variant (default `primary`), size (default `md`), width and extra classes.
 * @returns The class names.
 */
export function buttonClassName({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  className,
}: ButtonStyleOptions = {}): string {
  return cn(BASE, VARIANTS[variant], SIZES[size], fullWidth && 'w-full', className);
}

export interface IconButtonStyleOptions {
  variant?: ButtonVariant;
  size?: Exclude<ButtonSize, 'lg'>;
  className?: string;
}

/**
 * Builds a square, icon-only button's class list.
 *
 * @param options - Variant (default `ghost`), size (default `md`) and extra classes.
 * @returns The class names.
 */
export function iconButtonClassName({
  variant = 'ghost',
  size = 'md',
  className,
}: IconButtonStyleOptions = {}): string {
  return cn(BASE, VARIANTS[variant], 'shrink-0 rounded-full p-0', ICON_SIZES[size], className);
}
