import { useState, type SubmitEvent } from 'react';

import { hasErrorCode } from '@/api/errors';
import { useChangePassword } from '@/api/hooks/account';
import { describeApiError } from '@/api/messages';
import { FormError } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { PasswordField } from '@/components/ui/PasswordField';
import { useToast } from '@/components/ui/useToast';
import { useFormErrors } from '@/features/auth/useFormErrors';
import {
  apiFieldErrors,
  compactErrors,
  PASSWORD_HINT,
  validateNewPassword,
} from '@/features/auth/validation';

import { AccountSection } from './AccountSection';
import {
  CURRENT_PASSWORD_REQUIRED,
  CURRENT_PASSWORD_WRONG,
  PASSWORD_CHANGED_MESSAGE,
  PASSWORDS_DIFFER,
} from './copy';

const FIELDS = ['current_password', 'new_password', 'confirm_password'] as const;
const API_FIELDS = ['current_password', 'new_password'] as const;

/**
 * Changes the password. A wrong current password is shown on its field and never logs the user
 * out; the current session stays valid after the change.
 */
export function ChangePasswordForm() {
  const toast = useToast();
  const change = useChangePassword();
  const form = useFormErrors(FIELDS);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (change.isPending) {
      return;
    }
    const invalid = form.showErrors(
      compactErrors({
        current_password: current === '' ? CURRENT_PASSWORD_REQUIRED : undefined,
        new_password: validateNewPassword(next),
        confirm_password: confirm !== next ? PASSWORDS_DIFFER : undefined,
      }),
    );
    if (invalid) {
      return;
    }
    change.mutate(
      { current_password: current, new_password: next },
      {
        onSuccess: () => {
          setCurrent('');
          setNext('');
          setConfirm('');
          toast.show(PASSWORD_CHANGED_MESSAGE, { tone: 'success' });
        },
        onError: (error) => {
          if (hasErrorCode(error, 'invalid_credentials')) {
            form.showErrors({ current_password: CURRENT_PASSWORD_WRONG });
            return;
          }
          const fields = apiFieldErrors(error, API_FIELDS);
          form.showErrors(
            fields,
            Object.keys(fields).length === 0 ? describeApiError(error) : null,
          );
        },
      },
    );
  }

  return (
    <AccountSection
      title="Change password"
      description="You stay logged in here; other devices are logged out."
    >
      <form noValidate onSubmit={handleSubmit} className="flex flex-col gap-4">
        <PasswordField
          id={form.fieldId('current_password')}
          label="Current password"
          autoComplete="current-password"
          value={current}
          error={form.errors.current_password}
          onChange={(event) => {
            setCurrent(event.target.value);
            form.clearField('current_password');
          }}
        />
        <PasswordField
          id={form.fieldId('new_password')}
          label="New password"
          autoComplete="new-password"
          hint={PASSWORD_HINT}
          value={next}
          error={form.errors.new_password}
          onChange={(event) => {
            setNext(event.target.value);
            form.clearField('new_password');
          }}
        />
        <PasswordField
          id={form.fieldId('confirm_password')}
          label="Confirm new password"
          autoComplete="new-password"
          value={confirm}
          error={form.errors.confirm_password}
          onChange={(event) => {
            setConfirm(event.target.value);
            form.clearField('confirm_password');
          }}
        />
        <FormError message={form.formError} />
        <Button type="submit" loading={change.isPending} className="self-start">
          Change password
        </Button>
      </form>
    </AccountSection>
  );
}
