/**
 * Field and form-level error state for the auth forms.
 */
import { useCallback, useId, useState } from 'react';

import { firstInvalidField, type FieldErrorMap } from './validation';

export interface FormErrors<Field extends string> {
  /** Messages per field. */
  errors: FieldErrorMap<Field>;
  /** The form-level message (shown in a `FormError`), or `null`. */
  formError: string | null;
  /** The DOM id to give a field's control, so focus can move to it. */
  fieldId: (field: Field) => string;
  /**
   * Replaces all errors and moves focus to the first invalid field.
   *
   * @returns Whether anything is wrong.
   */
  showErrors: (errors: FieldErrorMap<Field>, formError?: string | null) => boolean;
  /** Clears one field's message (call when the user edits it). */
  clearField: (field: Field) => void;
}

/**
 * Tracks validation messages for a form's fields plus one form-level message.
 *
 * @param fields - The form's fields in display order.
 * @returns The errors and helpers to update them.
 */
export function useFormErrors<Field extends string>(fields: readonly Field[]): FormErrors<Field> {
  const formId = useId();
  const [errors, setErrors] = useState<FieldErrorMap<Field>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const fieldId = useCallback((field: Field) => `${formId}-${field}`, [formId]);

  const showErrors = useCallback(
    (next: FieldErrorMap<Field>, message: string | null = null) => {
      setErrors(next);
      setFormError(message);
      const first = firstInvalidField(next, fields);
      if (first !== undefined) {
        document.getElementById(fieldId(first))?.focus();
      }
      return first !== undefined || message !== null;
    },
    [fields, fieldId],
  );

  const clearField = useCallback((field: Field) => {
    setErrors((current) => {
      if (current[field] === undefined) {
        return current;
      }
      const { [field]: _cleared, ...rest } = current;
      return rest as FieldErrorMap<Field>;
    });
  }, []);

  return { errors, formError, fieldId, showErrors, clearField };
}
