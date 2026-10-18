import { useLayoutEffect, useState, type SubmitEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';

import { hasErrorCode } from '@/api/errors';
import { useConfirmPasswordReset } from '@/api/hooks/auth';
import { describeApiError } from '@/api/messages';
import { FormError } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { buttonClassName } from '@/components/ui/buttonStyles';
import { PasswordField } from '@/components/ui/PasswordField';
import { TextLink } from '@/components/ui/TextLink';
import { useFocusOnMount } from '@/hooks/useFocusOnMount';

import { AuthLayout } from './AuthLayout';
import { readResetToken, RESET_PASSWORD_PATH } from './resetToken';
import { useFormErrors } from './useFormErrors';
import { apiFieldErrors, compactErrors, PASSWORD_HINT, validateNewPassword } from './validation';

export const INVALID_LINK_MESSAGE = 'This reset link is invalid or has expired.';

const FIELDS = ['password', 'confirm'] as const;

type Stage = 'form' | 'invalid' | 'done';

function InvalidLink() {
  const ref = useFocusOnMount<HTMLDivElement>();
  return (
    <div ref={ref} tabIndex={-1} className="flex flex-col gap-4 outline-none">
      <p className="text-sm text-fg">
        {INVALID_LINK_MESSAGE} Reset links work once and expire after an hour.
      </p>
      <Link to="/forgot-password" className={buttonClassName({ fullWidth: true })}>
        Request a new link
      </Link>
    </div>
  );
}

function PasswordChanged() {
  const ref = useFocusOnMount<HTMLDivElement>();
  return (
    <div ref={ref} tabIndex={-1} role="status" className="flex flex-col gap-4 outline-none">
      <p className="font-heading text-base text-fg">password changed ✧</p>
      <p className="text-sm text-fg">
        You&apos;re all set. Log in with your new password; any other sessions were logged out.
      </p>
      <Link to="/login" className={buttonClassName({ fullWidth: true })}>
        Log in
      </Link>
    </div>
  );
}

/**
 * `/reset-password#token=…`: sets a new password. The token is read from the fragment once and
 * removed from the address bar and history right away (the router replaces the entry with
 * `/reset-password`); it is only ever sent in the confirm request body.
 */
export function ResetPasswordPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const confirmReset = useConfirmPasswordReset();
  const { errors, formError, fieldId, showErrors, clearField } = useFormErrors(FIELDS);
  const [token] = useState(() => readResetToken(location.hash));
  const [stage, setStage] = useState<Stage>(token === null ? 'invalid' : 'form');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const hasFragment = location.hash !== '';

  useLayoutEffect(() => {
    if (hasFragment) {
      void navigate(RESET_PASSWORD_PATH, { replace: true });
    }
  }, [hasFragment, navigate]);

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (confirmReset.isPending || token === null) {
      return;
    }
    const invalid = showErrors(
      compactErrors({
        password: validateNewPassword(password),
        confirm: confirm === password ? undefined : "Passwords don't match.",
      }),
    );
    if (invalid) {
      return;
    }
    confirmReset.mutate(
      { token, password },
      {
        onSuccess: () => {
          setStage('done');
        },
        onError: (error) => {
          const fields = apiFieldErrors(error, ['password', 'token'] as const);
          if (hasErrorCode(error, 'invalid_token') || fields.token !== undefined) {
            setStage('invalid');
            return;
          }
          showErrors(
            compactErrors({ password: fields.password, confirm: undefined }),
            fields.password === undefined ? describeApiError(error) : null,
          );
        },
      },
    );
  }

  return (
    <AuthLayout title="new password" documentTitle="Reset password">
      {stage === 'invalid' && <InvalidLink />}
      {stage === 'done' && <PasswordChanged />}
      {stage === 'form' && (
        <>
          <form noValidate onSubmit={handleSubmit} className="flex flex-col gap-4">
            <PasswordField
              id={fieldId('password')}
              label="New password"
              autoComplete="new-password"
              required
              hint={PASSWORD_HINT}
              value={password}
              error={errors.password}
              onChange={(event) => {
                setPassword(event.target.value);
                clearField('password');
              }}
            />
            <PasswordField
              id={fieldId('confirm')}
              label="Confirm new password"
              autoComplete="new-password"
              required
              value={confirm}
              error={errors.confirm}
              onChange={(event) => {
                setConfirm(event.target.value);
                clearField('confirm');
              }}
            />
            <FormError message={formError} />
            <Button type="submit" fullWidth loading={confirmReset.isPending}>
              Set new password
            </Button>
          </form>
          <p className="text-center text-sm text-muted">
            <TextLink to="/login">Back to log in</TextLink>
          </p>
        </>
      )}
    </AuthLayout>
  );
}
