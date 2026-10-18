import { useState, type SubmitEvent } from 'react';
import { useLocation, useNavigate } from 'react-router';

import { hasErrorCode } from '@/api/errors';
import { useSignup } from '@/api/hooks/auth';
import { describeApiError } from '@/api/messages';
import { FormError } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { PasswordField } from '@/components/ui/PasswordField';
import { TextField } from '@/components/ui/TextField';
import { TextLink } from '@/components/ui/TextLink';
import { normalizeUsername, validateUsername } from '@/lib/username';

import { AuthLayout } from './AuthLayout';
import { redirectTarget } from './redirect';
import { useFormErrors } from './useFormErrors';
import { UsernameField } from './UsernameField';
import {
  apiFieldErrors,
  compactErrors,
  EMAIL_MAX_LENGTH,
  PASSWORD_HINT,
  validateEmail,
  validateNewPassword,
} from './validation';

const FIELDS = ['username', 'email', 'password'] as const;

export const EMAIL_TAKEN_MESSAGE = 'An account with this email already exists.';

/**
 * `/signup`: username, email and password (the display name starts as the
 * username). A taken email or username and the API's field errors show inline on their fields;
 * on success the new user lands on the page they came for, or their profile.
 */
export function SignupPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const signup = useSignup();
  const { errors, formError, fieldId, showErrors, clearField } = useFormErrors(FIELDS);
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (signup.isPending) {
      return;
    }
    const invalid = showErrors(
      compactErrors({
        username: validateUsername(username),
        email: validateEmail(email),
        password: validateNewPassword(password),
      }),
    );
    if (invalid) {
      return;
    }
    signup.mutate(
      {
        username: normalizeUsername(username),
        email: email.trim(),
        password,
      },
      {
        onSuccess: (user) => {
          void navigate(redirectTarget(location.state, user.username), { replace: true });
        },
        onError: (error) => {
          if (hasErrorCode(error, 'email_taken')) {
            showErrors({ email: EMAIL_TAKEN_MESSAGE });
            return;
          }
          if (hasErrorCode(error, 'username_taken')) {
            showErrors({ username: error.message });
            return;
          }
          const fields = apiFieldErrors(error, FIELDS);
          showErrors(fields, Object.keys(fields).length > 0 ? null : describeApiError(error));
        },
      },
    );
  }

  return (
    <AuthLayout title="sign up" documentTitle="Sign up">
      <form noValidate onSubmit={handleSubmit} className="flex flex-col gap-4">
        <UsernameField
          id={fieldId('username')}
          value={username}
          error={errors.username}
          onChange={(value) => {
            setUsername(value);
            clearField('username');
          }}
        />
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
        <FormError message={formError} />
        <Button type="submit" fullWidth loading={signup.isPending}>
          Create account
        </Button>
      </form>
      <p className="text-center text-sm text-muted">
        Already have an account?{' '}
        <TextLink to="/login" state={location.state as unknown}>
          Log in
        </TextLink>
      </p>
    </AuthLayout>
  );
}
