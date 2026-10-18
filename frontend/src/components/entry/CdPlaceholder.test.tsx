import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { cdPlaceholder } from '@/lib/hash';

import { CdPlaceholder } from './CdPlaceholder';

function renderDisc(seed: string, className?: string): HTMLElement {
  const { container } = render(<CdPlaceholder seed={seed} className={className} />);
  const root = container.firstElementChild;
  if (!(root instanceof HTMLElement)) {
    throw new Error('CdPlaceholder not rendered');
  }
  return root;
}

function discGradient(root: HTMLElement): string {
  return root.style.getPropertyValue('--cd-disc');
}

describe('CdPlaceholder', () => {
  it('is a decorative square hidden from assistive technology', () => {
    const root = renderDisc('Gosh');

    expect(root).toHaveAttribute('aria-hidden', 'true');
    expect(root).toHaveAttribute('data-cd-placeholder');
    expect(root).toHaveClass('aspect-square');
    expect(root.textContent).toBe('');
  });

  it('draws the conic gradient derived from the seed', () => {
    const root = renderDisc('Gosh');

    expect(discGradient(root)).toBe(cdPlaceholder('Gosh', '').backgroundImage);
    expect(discGradient(root)).toMatch(/^conic-gradient\(from \d+deg, hsl\(/);
  });

  it('draws the same disc for the same seed and a different one for another seed', () => {
    const first = discGradient(renderDisc('Teardrop'));
    const again = discGradient(renderDisc('Teardrop'));
    const other = discGradient(renderDisc('Loud Places'));

    expect(again).toBe(first);
    expect(other).not.toBe(first);
  });

  it('merges the given classes', () => {
    const root = renderDisc('Gosh', 'size-full');

    expect(root).toHaveClass('size-full', 'aspect-square', 'bg-surface');
  });
});
