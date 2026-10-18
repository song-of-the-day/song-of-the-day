import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { ThemeBackground } from '@/lib/theme';

import { Backdrop } from './Backdrop';

const UPLOAD_ID = '6f1c2a5e-8d1b-4c1e-9f57-0b6f7d2a9c11';

function renderBackdrop(background: Partial<ThemeBackground>) {
  const { container } = render(
    <Backdrop
      background={{ pattern: 'grid', image_upload_id: null, image_fit: 'cover', ...background }}
    />,
  );
  const layer = container.querySelector('.sotd-backdrop');
  if (!(layer instanceof HTMLElement)) {
    throw new Error('Backdrop not rendered');
  }
  return layer;
}

describe('Backdrop', () => {
  it('is a decorative layer hidden from assistive technology', () => {
    const layer = renderBackdrop({});

    expect(layer).toHaveAttribute('aria-hidden', 'true');
    expect(layer).toBeEmptyDOMElement();
  });

  it('draws the pattern when there is no image', () => {
    const layer = renderBackdrop({ pattern: 'scanlines' });

    expect(layer).toHaveAttribute('data-pattern', 'scanlines');
    expect(layer).not.toHaveAttribute('data-image-fit');
    expect(layer.style.backgroundImage).toBe('');
  });

  it('draws the uploaded image instead of the pattern', () => {
    const layer = renderBackdrop({ pattern: 'dots', image_upload_id: UPLOAD_ID });

    expect(layer).not.toHaveAttribute('data-pattern');
    expect(layer).toHaveAttribute('data-image-fit', 'cover');
    expect(layer.style.backgroundImage).toBe(`url("/api/uploads/${UPLOAD_ID}")`);
  });

  it('can tile the image', () => {
    const layer = renderBackdrop({ image_upload_id: UPLOAD_ID, image_fit: 'tile' });

    expect(layer).toHaveAttribute('data-image-fit', 'tile');
  });
});
