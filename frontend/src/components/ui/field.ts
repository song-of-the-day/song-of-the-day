/**
 * Shared wiring for labelled form controls: ids, `aria-describedby` and control styling.
 */
import { useId, type ReactNode } from 'react';

/** The outlined control look shared by text inputs, text areas and selects. */
export const CONTROL_CLASS_NAME =
  'block w-full min-h-11 rounded-md border border-muted bg-surface px-3 py-2 text-base text-fg placeholder:text-muted disabled:cursor-not-allowed disabled:opacity-60 aria-invalid:border-fg aria-invalid:ring-1 aria-invalid:ring-fg aria-invalid:ring-inset';

/**
 * Joins element ids for an `aria-describedby` value.
 *
 * @param ids - Ids, or falsy values to skip.
 * @returns The space-separated ids, or `undefined` when there are none.
 */
export function joinIds(...ids: (string | false | null | undefined)[]): string | undefined {
  const present = ids.filter((id): id is string => typeof id === 'string' && id !== '');
  return present.length === 0 ? undefined : present.join(' ');
}

export interface FieldIds {
  /** The control's id (the caller's, or a generated one). */
  controlId: string;
  hintId: string;
  errorId: string;
}

/**
 * Generates the ids a labelled control needs.
 *
 * @param id - The caller's control id, if any.
 * @returns Ids for the control, its hint and its error message.
 */
export function useFieldIds(id: string | undefined): FieldIds {
  const generated = useId();
  const controlId = id ?? generated;
  return { controlId, hintId: `${controlId}-hint`, errorId: `${controlId}-error` };
}

/**
 * Checks whether an optional hint or error was given.
 *
 * @param node - The hint or error prop.
 * @returns `false` for `undefined`, `null`, booleans and empty strings.
 */
export function hasContent(node: ReactNode): boolean {
  return node !== undefined && node !== null && typeof node !== 'boolean' && node !== '';
}
