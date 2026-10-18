/**
 * Form helpers for tests.
 */
import { fireEvent, screen } from '@testing-library/react';

/**
 * Submits the form containing a button programmatically (like `form.requestSubmit()` without a
 * submitter), bypassing the button's own click handling.
 *
 * @param buttonName - The accessible name of a button inside the form.
 */
export function submitFormOf(buttonName: string): void {
  const form = screen.getByRole('button', { name: buttonName }).closest('form');
  if (form === null) {
    throw new Error(`No form contains the "${buttonName}" button`);
  }
  fireEvent.submit(form);
}
