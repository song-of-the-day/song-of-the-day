import { useState, type SubmitEvent } from 'react';

import { useRequestPasswordReset } from '@/api/hooks/auth';
import { describeApiError } from '@/api/messages';
import { FormError } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { TEXT_LINK_CLASS_NAME, TextLink } from '@/components/ui/TextLink';
import { useFocusOnMount } from '@/hooks/useFocusOnMount';

import { AuthLayout } from './AuthLayout';
import { useFormErrors } from './useFormErrors';
import { apiFieldErrors, compactErrors, EMAIL_MAX_LENGTH, validateEmail } from './validation';

const FIELDS = ['email'] as const;

interface ConfirmationProps {
  email: string;
  onRetry: () => void;
}

function Confirmation({ email, onRetry }: ConfirmationProps) {
  const ref = useFocusOnMount<HTMLDivElement>();

  return (
    <>
      <div ref={ref} tabIndex={-1} role="status" className="flex flex-col gap-3 outline-none">
        <p className="font-heading text-base text-fg">check your inbox ✧</p>
        <p className="text-sm text-fg">
          If an account exists for <strong className="break-all">{email}</strong>, we sent it a link
          to reset your password. The link expires in 1 hour.
        </p>
      </div>
      <p className="text-sm text-muted">
        No email? Check your spam folder, or{' '}
        <button type="button" onClick={onRetry} className={TEXT_LINK_CLASS_NAME}>
          try another address
        </button>
        .
      </p>
      <p className="text-center text-sm">
        <TextLink to="/login">Back to log in</TextLink>
      </p>
    </>
  );
}

/**
 * `/forgot-password`: asks for a reset link. After a successful request it shows the same
 * confirmation whether or not the account exists (the API never reveals it).
 */
export function ForgotPasswordPage() {
  const requestReset = useRequestPasswordReset();
  const { errors, formError, fieldId, showErrors, clearField } = useFormErrors(FIELDS);
  const [email, setEmail] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (requestReset.isPending) {
      return;
    }
    if (showErrors(compactErrors({ email: validateEmail(email) }))) {
      return;
    }
    const address = email.trim();
    requestReset.mutate(
      { email: address },
      {
        onSuccess: () => {
          setSentTo(address);
        },
        onError: (error) => {
          const fields = apiFieldErrors(error, FIELDS);
          showErrors(fields, Object.keys(fields).length > 0 ? null : describeApiError(error));
        },
      },
    );
  }

  return (
    <AuthLayout title="forgot password" documentTitle="Forgot password">
      {sentTo === null ? (
        <>
          <p className="text-sm text-fg">
            Enter your account&apos;s email and we&apos;ll send you a link to choose a new password.
          </p>
          <form noValidate onSubmit={handleSubmit} className="flex flex-col gap-4">
            <TextField
              id={fieldId('email')}
              label="Email"
              type="email"
              autoComplete="email"
              inputMode="email"
              maxLength={EMAIL_MAX_LENGTH}
              required
              value={email}
              error={errors.email}
              onChange={(event) => {
                setEmail(event.target.value);
                clearField('email');
              }}
            />
            <FormError message={formError} />
            <Button type="submit" fullWidth loading={requestReset.isPending}>
              Send reset link
            </Button>
          </form>
          <p className="text-center text-sm text-muted">
            Remembered it? <TextLink to="/login">Log in</TextLink>
          </p>
        </>
      ) : (
        <Confirmation
          email={sentTo}
          onRetry={() => {
            setSentTo(null);
          }}
        />
      )}
    </AuthLayout>
  );
}
