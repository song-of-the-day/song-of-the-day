import { TriangleAlert } from 'lucide-react';
import { useState, type SubmitEvent } from 'react';
import { useNavigate } from 'react-router';

import { hasErrorCode } from '@/api/errors';
import { useDeleteAccount } from '@/api/hooks/account';
import { describeApiError } from '@/api/messages';
import { FormError } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { PasswordField } from '@/components/ui/PasswordField';
import { TextField } from '@/components/ui/TextField';
import { useToast } from '@/components/ui/useToast';
import { useFormErrors } from '@/features/auth/useFormErrors';
import { apiFieldErrors, compactErrors } from '@/features/auth/validation';

import { AccountSection } from './AccountSection';
import {
  ACCOUNT_DELETED_MESSAGE,
  DELETE_PHRASE,
  DELETE_PHRASE_MISMATCH,
  PASSWORD_REQUIRED,
  PASSWORD_WRONG,
} from './copy';

const FIELDS = ['password', 'phrase'] as const;
const API_FIELDS = ['password'] as const;

/**
 * The danger zone: permanently deletes the account after the password and a typed confirmation
 * phrase, then sends the user to the login page.
 */
export function DeleteAccountForm() {
  const toast = useToast();
  const navigate = useNavigate();
  const deleteAccount = useDeleteAccount();
  const form = useFormErrors(FIELDS);
  const [password, setPassword] = useState('');
  const [phrase, setPhrase] = useState('');

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (deleteAccount.isPending) {
      return;
    }
    const invalid = form.showErrors(
      compactErrors({
        password: password === '' ? PASSWORD_REQUIRED : undefined,
        phrase: phrase.trim().toLowerCase() === DELETE_PHRASE ? undefined : DELETE_PHRASE_MISMATCH,
      }),
    );
    if (invalid) {
      return;
    }
    try {
      // Awaited rather than a mutate callback: ending the session unmounts this dialog.
      await deleteAccount.mutateAsync({ password });
    } catch (error) {
      if (hasErrorCode(error, 'invalid_credentials')) {
        form.showErrors({ password: PASSWORD_WRONG });
        return;
      }
      const fields = apiFieldErrors(error, API_FIELDS);
      form.showErrors(fields, Object.keys(fields).length === 0 ? describeApiError(error) : null);
      return;
    }
    toast.show(ACCOUNT_DELETED_MESSAGE, { tone: 'success' });
    await navigate('/login', { replace: true });
  }

  return (
    <AccountSection
      title="Delete account"
      danger
      description={
        <span className="flex items-start gap-2 text-fg">
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span>
            This permanently deletes your account, every song and note, and your background images.
            It can&apos;t be undone, so download your data first if you want a copy.
          </span>
        </span>
      }
    >
      <form
        noValidate
        onSubmit={(event) => {
          void handleSubmit(event);
        }}
        className="flex flex-col gap-4"
      >
        <PasswordField
          id={form.fieldId('password')}
          label="Your password"
          autoComplete="current-password"
          value={password}
          error={form.errors.password}
          onChange={(event) => {
            setPassword(event.target.value);
            form.clearField('password');
          }}
        />
        <TextField
          id={form.fieldId('phrase')}
          label={
            <>
              Type <strong className="font-semibold">{DELETE_PHRASE}</strong> to confirm
            </>
          }
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          value={phrase}
          error={form.errors.phrase}
          onChange={(event) => {
            setPhrase(event.target.value);
            form.clearField('phrase');
          }}
        />
        <FormError message={form.formError} />
        <Button
          type="submit"
          variant="danger"
          loading={deleteAccount.isPending}
          className="self-start"
        >
          Delete my account
        </Button>
      </form>
    </AccountSection>
  );
}
