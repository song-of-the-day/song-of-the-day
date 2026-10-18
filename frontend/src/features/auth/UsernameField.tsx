import { useState, type ReactNode } from 'react';

import { TextField } from '@/components/ui/TextField';
import { USERNAME_MAX_LENGTH, validateUsername } from '@/lib/username';

export interface UsernameFieldProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  /** A message from the form or the API; shown until the value changes. */
  error?: string;
  /** Shown while the value differs from the saved username (the account dialog). */
  changeWarning?: ReactNode;
}

/**
 * The username input shared by signup and the account dialog. The messages
 * are the sentences from `shared/usernames.json` (the API's own `fields.username` text); the
 * field checks on blur and, once blurred, again as the user types. The parent form checks on
 * submit, and the API stays the authority (`409 username_taken`).
 */
export function UsernameField({ id, value, onChange, error, changeWarning }: UsernameFieldProps) {
  const [blurred, setBlurred] = useState(false);
  const localError = blurred ? validateUsername(value) : undefined;

  return (
    <TextField
      id={id}
      label="Username"
      autoComplete="username"
      autoCapitalize="none"
      spellCheck={false}
      maxLength={USERNAME_MAX_LENGTH}
      required
      value={value}
      error={error ?? localError}
      hint={
        changeWarning !== undefined && (
          <span className="block font-medium text-fg">{changeWarning}</span>
        )
      }
      onBlur={() => {
        setBlurred(true);
      }}
      onChange={(event) => {
        onChange(event.target.value);
      }}
    />
  );
}
