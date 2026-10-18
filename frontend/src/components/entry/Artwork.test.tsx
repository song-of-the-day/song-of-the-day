import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Artwork, type ArtworkSize } from './Artwork';

const SRC = 'https://is1-ssl.mzstatic.com/image/thumb/Music125/v4/b9/dc/ce/600x600bb.jpg';
const OTHER_SRC = 'https://is1-ssl.mzstatic.com/image/thumb/Music116/v4/aa/bb/cc/600x600bb.jpg';
const NAME = 'Gosh by Jamie xx artwork';

function placeholderOf(container: HTMLElement): HTMLElement | null {
  return container.querySelector('[data-cd-placeholder]');
}

function discGradient(container: HTMLElement): string {
  const placeholder = placeholderOf(container);
  if (placeholder === null) {
    throw new Error('No CD placeholder rendered');
  }
  return placeholder.style.getPropertyValue('--cd-disc');
}

describe('Artwork', () => {
  it('renders a lazy, async-decoded image named after the song inside a hairline box', () => {
    const { container } = render(<Artwork src={SRC} title="Gosh" artist="Jamie xx" />);

    const image = screen.getByRole('img', { name: NAME });
    expect(image.tagName).toBe('IMG');
    expect(image).toHaveAttribute('src', SRC);
    expect(image).toHaveAttribute('loading', 'lazy');
    expect(image).toHaveAttribute('decoding', 'async');
    expect(image).toHaveClass('size-full', 'object-cover');
    expect(image.parentElement).toHaveClass('border', 'border-line', 'size-20');
    expect(placeholderOf(container)).toBeNull();
  });

  it.each<[ArtworkSize, string, string]>([
    ['sm', 'size-12', '48'],
    ['md', 'size-20', '80'],
    ['lg', 'size-48', '192'],
    ['fill', 'aspect-square', '600'],
  ])('maps the %s preset to a fixed square box', (size, sizeClass, pixels) => {
    render(<Artwork src={SRC} title="Gosh" artist="Jamie xx" size={size} className="rounded" />);

    const image = screen.getByRole('img', { name: NAME });
    expect(image.parentElement).toHaveClass(sizeClass, 'rounded');
    expect(image).toHaveAttribute('width', pixels);
    expect(image).toHaveAttribute('height', pixels);
  });

  it('fills the container width in the fill preset', () => {
    render(<Artwork src={null} title="Gosh" artist="Jamie xx" size="fill" />);

    expect(screen.getByRole('img', { name: NAME })).toHaveClass('w-full', 'aspect-square');
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty', ''],
  ])('shows the CD placeholder, named like the image, when the URL is %s', (_label, src) => {
    const { container } = render(<Artwork src={src} title="Gosh" artist="Jamie xx" size="sm" />);

    const artwork = screen.getByRole('img', { name: NAME });
    expect(artwork.tagName).toBe('SPAN');
    expect(artwork).toHaveClass('size-12', 'border-line');
    expect(container.querySelector('img')).toBeNull();
    expect(placeholderOf(container)).toHaveAttribute('aria-hidden', 'true');
  });

  it('falls back to the CD placeholder when the image fails to load', () => {
    const { container } = render(<Artwork src={SRC} title="Gosh" artist="Jamie xx" />);

    fireEvent.error(screen.getByRole('img', { name: NAME }));

    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByRole('img', { name: NAME }).tagName).toBe('SPAN');
    expect(placeholderOf(container)).not.toBeNull();
  });

  it('tries a new URL after an earlier one failed', () => {
    const { container, rerender } = render(<Artwork src={SRC} title="Gosh" artist="Jamie xx" />);
    fireEvent.error(screen.getByRole('img', { name: NAME }));

    rerender(<Artwork src={OTHER_SRC} title="Gosh" artist="Jamie xx" />);

    expect(screen.getByRole('img', { name: NAME })).toHaveAttribute('src', OTHER_SRC);
    expect(placeholderOf(container)).toBeNull();
  });

  it('seeds the placeholder from the title and artist', () => {
    const gosh = render(<Artwork src={null} title="Gosh" artist="Jamie xx" />);
    const goshAgain = render(<Artwork src={null} title="Gosh" artist="Jamie xx" />);
    const loudPlaces = render(<Artwork src={null} title="Loud Places" artist="Jamie xx" />);
    const shifted = render(<Artwork src={null} title="Gos" artist="hJamie xx" />);

    const disc = discGradient(gosh.container);
    expect(discGradient(goshAgain.container)).toBe(disc);
    expect(discGradient(loudPlaces.container)).not.toBe(disc);
    expect(discGradient(shifted.container)).not.toBe(disc);
  });
});
