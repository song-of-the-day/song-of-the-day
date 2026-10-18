/**
 * Stable hashing for generated visuals (the "CD" placeholder for missing artwork).
 */

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/**
 * Hashes a string with 32-bit FNV-1a over its UTF-16 code units.
 *
 * @param value - Any string.
 * @returns An unsigned 32-bit integer that is stable across sessions and browsers.
 */
export function hashString(value: string): number {
  let hash = FNV_OFFSET_BASIS;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, FNV_PRIME);
  }
  return hash >>> 0;
}

/** The parameters of a CD placeholder's conic gradient. */
export interface CdPlaceholder {
  /** Start angle of the gradient in degrees (0–359). */
  angle: number;
  /** Three pastel colors as CSS `hsl()` strings. */
  colors: [string, string, string];
  /** A ready-to-use CSS `background-image` value. */
  backgroundImage: string;
}

/**
 * Derives a CD placeholder from a song, so the same song always gets the same disc.
 *
 * @param title - The song title.
 * @param artist - The song artist.
 * @returns The gradient angle, colors and CSS value.
 */
export function cdPlaceholder(title: string, artist: string): CdPlaceholder {
  const hash = hashString(`${title}\u0000${artist}`);
  const angle = hash % 360;
  const baseHue = (hash >>> 9) % 360;
  const spread = 40 + ((hash >>> 18) % 80);
  const colors: [string, string, string] = [
    `hsl(${baseHue} 85% 82%)`,
    `hsl(${(baseHue + spread) % 360} 80% 78%)`,
    `hsl(${(baseHue + 2 * spread) % 360} 85% 85%)`,
  ];
  const [first, second, third] = colors;
  return {
    angle,
    colors,
    backgroundImage: `conic-gradient(from ${angle}deg, ${first}, ${second}, ${third}, ${first})`,
  };
}
