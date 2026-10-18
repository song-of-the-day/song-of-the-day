/**
 * Class name joining.
 */

/** A class name, or a falsy value to skip. */
export type ClassValue = string | false | null | undefined;

/**
 * Joins class names, skipping falsy values.
 *
 * @param classes - Class names, possibly conditional (`isActive && 'active'`).
 * @returns The space-separated class list.
 */
export function cn(...classes: ClassValue[]): string {
  return classes.filter(Boolean).join(' ');
}
