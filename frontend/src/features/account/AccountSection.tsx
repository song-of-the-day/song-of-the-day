import { useId, type ReactNode } from 'react';

import { cn } from '@/lib/cn';

export interface AccountSectionProps {
  title: string;
  /** A short explanation under the title. */
  description?: ReactNode;
  /** Frame the section as a danger zone. */
  danger?: boolean;
  children: ReactNode;
}

/** One titled part of the account dialog. */
export function AccountSection({
  title,
  description,
  danger = false,
  children,
}: AccountSectionProps) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className={cn(
        'flex flex-col gap-3',
        danger ? 'rounded-md border-2 border-dashed border-fg p-4' : 'border-b border-line pb-6',
      )}
    >
      <div className="flex flex-col gap-1">
        <h3 id={headingId} className="font-heading text-base text-fg">
          {title}
        </h3>
        {description !== undefined && <p className="text-sm text-muted">{description}</p>}
      </div>
      {children}
    </section>
  );
}
