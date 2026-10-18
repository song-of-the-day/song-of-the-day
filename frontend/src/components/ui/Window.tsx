import { useId, type ComponentPropsWithRef, type ReactNode } from 'react';

import { cn } from '@/lib/cn';

export interface WindowTitleBarProps {
  /** The title element (a heading, or a dialog's Radix `Title`). */
  children: ReactNode;
  /** Controls at the right end, e.g. a close button. */
  actions?: ReactNode;
  className?: string;
}

/**
 * A Y2K window title bar: three tiny decorative dots, the title in the heading font and optional
 * actions.
 */
export function WindowTitleBar({ children, actions, className }: WindowTitleBarProps) {
  return (
    <div className={cn('y2k-titlebar shrink-0', className)}>
      <span className="y2k-dots" aria-hidden="true" />
      <div className="min-w-0 flex-1">{children}</div>
      {actions !== undefined && <div className="-mr-1 flex items-center gap-1">{actions}</div>}
    </div>
  );
}

export type HeadingLevel = 1 | 2 | 3 | 4;

export interface WindowProps extends Omit<ComponentPropsWithRef<'section'>, 'title'> {
  /** The title shown in the title bar, rendered as a heading that labels the window. */
  title: ReactNode;
  /** The title's heading level (default 2). */
  headingLevel?: HeadingLevel;
  actions?: ReactNode;
  /** Classes for the body; they replace the default padding. */
  bodyClassName?: string;
}

/**
 * A surface panel in the "window" style: hairline border, title bar and a hard 2px offset
 * shadow. Used for cards, the auth card, empty states and error screens.
 */
export function Window({
  title,
  headingLevel = 2,
  actions,
  className,
  bodyClassName,
  children,
  ...props
}: WindowProps) {
  const titleId = useId();
  const Heading = `h${String(headingLevel)}` as `h${HeadingLevel}`;
  return (
    <section aria-labelledby={titleId} className={cn('y2k-window', className)} {...props}>
      <WindowTitleBar actions={actions}>
        <Heading id={titleId} className="truncate">
          {title}
        </Heading>
      </WindowTitleBar>
      <div className={bodyClassName ?? 'p-4 sm:p-6'}>{children}</div>
    </section>
  );
}
