import { useId, type ReactNode } from 'react';

export interface SectionProps {
  title: string;
  /** Shown at the right of the heading, e.g. a "custom" badge. */
  aside?: ReactNode;
  children: ReactNode;
}

/** One titled group of the customize sheet, separated from the next by a hairline. */
export function Section({ title, aside, children }: SectionProps) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-3 border-b border-line py-5 first:pt-1 last:border-b-0 last:pb-1"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 id={headingId} className="font-heading text-sm tracking-wide text-fg">
          {title}
        </h3>
        {aside}
      </div>
      {children}
    </section>
  );
}
