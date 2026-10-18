import { useState, type SubmitEvent } from 'react';
import { useLocation, useNavigate } from 'react-router';

import { hasErrorCode } from '@/api/errors';
import { useLogin } from '@/api/hooks/auth';
import { describeApiError } from '@/api/messages';
import { FormError } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { PasswordField } from '@/components/ui/PasswordField';
import { TextField } from '@/components/ui/TextField';
import { TextLink } from '@/components/ui/TextLink';

import { AuthLayout } from './AuthLayout';
import { redirectTarget } from './redirect';
import { useFormErrors } from './useFormErrors';
import { apiFieldErrors, compactErrors, EMAIL_MAX_LENGTH, validateEmail } from './validation';

const FIELDS = ['email', 'password'] as const;

export const INVALID_CREDENTIALS_MESSAGE = 'Incorrect email or password.';

/**
 * `/login`: email, password and "Keep me logged in" (on by default). On success it returns to
 * the page that required logging in, or the profile.
 */
export function LoginPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const login = useLogin();
  const { errors, formError, fieldId, showErrors, clearField } = useFormErrors(FIELDS);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (login.isPending) {
      return;
    }
    const invalid = showErrors(
      compactErrors({
        email: validateEmail(email),
        password: password === '' ? 'Enter your password.' : undefined,
      }),
    );
    if (invalid) {
      return;
    }
    login.mutate(
      { email: email.trim(), password, remember },
      {
        onSuccess: (user) => {
          void navigate(redirectTarget(location.state, user.username), { replace: true });
        },
        onError: (error) => {
          if (hasErrorCode(error, 'invalid_credentials')) {
            showErrors({}, INVALID_CREDENTIALS_MESSAGE);
            return;
          }
          const fields = apiFieldErrors(error, FIELDS);
          showErrors(fields, Object.keys(fields).length > 0 ? null : describeApiError(error));
        },
      },
    );
  }

  return (
    <AuthLayout title="log in" documentTitle="Log in">
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
        <PasswordField
          id={fieldId('password')}
          label="Password"
          autoComplete="current-password"
          required
          value={password}
          error={errors.password}
          onChange={(event) => {
            setPassword(event.target.value);
            clearField('password');
          }}
        />
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <Checkbox
            label="Keep me logged in"
            checked={remember}
            onChange={(event) => {
              setRemember(event.target.checked);
            }}
          />
          <TextLink to="/forgot-password" className="text-sm">
            Forgot password?
          </TextLink>
        </div>
        <FormError message={formError} />
        <Button type="submit" fullWidth loading={login.isPending}>
          Log in
        </Button>
      </form>
      <p className="text-center text-sm text-muted">
        New here?{' '}
        <TextLink to="/signup" state={location.state as unknown}>
          Create an account
        </TextLink>
      </p>
    </AuthLayout>
  );
}
