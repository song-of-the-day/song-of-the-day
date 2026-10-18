import { useState, type SubmitEvent } from 'react';
import { useLocation, useNavigate } from 'react-router';

import { hasErrorCode } from '@/api/errors';
import { useMe } from '@/api/hooks/auth';
import { useUpdateProfile } from '@/api/hooks/profile';
import { describeApiError } from '@/api/messages';
import type { User } from '@/api/types';
import { FormError } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/useToast';
import { profilePath } from '@/features/auth/redirect';
import { useFormErrors } from '@/features/auth/useFormErrors';
import { UsernameField } from '@/features/auth/UsernameField';
import { apiFieldErrors } from '@/features/auth/validation';
import { normalizeUsername, validateUsername } from '@/lib/username';

import { AccountSection } from './AccountSection';
import { USERNAME_CHANGE_WARNING, USERNAME_SAVED_MESSAGE } from './copy';

const FIELDS = ['username'] as const;

/**
 * The username section of the account dialog. Changing the username moves the
 * page to its new URL (the old link stops working); a name that's taken (`409 username_taken`) or
 * invalid (`422`) is shown on the field, and the API stays the authority. The field is unchanged
 * for a visitor because the dialog is owner-only.
 */
export function UsernameSection() {
  const { data: user } = useMe();
  if (user === undefined || user === null) {
    return null;
  }
  return <UsernameEditor user={user} />;
}

function UsernameEditor({ user }: { user: User }) {
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const form = useFormErrors(FIELDS);
  const [value, setValue] = useState(user.username);
  const update = useUpdateProfile({
    onUsernameChange: (username) =>
      navigate(
        { pathname: profilePath(username), search: location.search, hash: location.hash },
        { replace: true },
      ),
  });

  const saved = user.username;
  const changed = normalizeUsername(value) !== saved;

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (update.isPending || !changed) {
      return;
    }
    const error = validateUsername(value);
    if (form.showErrors(error === undefined ? {} : { username: error })) {
      return;
    }
    update.mutate(
      { username: normalizeUsername(value) },
      {
        onSuccess: (updated) => {
          setValue(updated.username);
          toast.show(USERNAME_SAVED_MESSAGE, { tone: 'success' });
        },
        onError: (mutationError) => {
          if (hasErrorCode(mutationError, 'username_taken')) {
            form.showErrors({ username: mutationError.message });
            return;
          }
          const fields = apiFieldErrors(mutationError, FIELDS);
          form.showErrors(
            fields,
            Object.keys(fields).length === 0 ? describeApiError(mutationError) : null,
          );
        },
      },
    );
  }

  return (
    <AccountSection
      title="Username"
      description="Your profile lives at this link. Anyone with it can see your page."
    >
      <form noValidate onSubmit={handleSubmit} className="flex flex-col gap-4">
        <UsernameField
          id={form.fieldId('username')}
          value={value}
          error={form.errors.username}
          changeWarning={changed ? USERNAME_CHANGE_WARNING : undefined}
          onChange={(next) => {
            setValue(next);
            form.clearField('username');
          }}
        />
        <FormError message={form.formError} />
        <Button type="submit" loading={update.isPending} disabled={!changed} className="self-start">
          Change username
        </Button>
      </form>
    </AccountSection>
  );
}
