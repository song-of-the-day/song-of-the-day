import { Eye, EyeOff } from 'lucide-react';
import { useState } from 'react';

import { IconButton } from './IconButton';
import { TextField, type TextFieldProps } from './TextField';

export type PasswordFieldProps = Omit<TextFieldProps, 'type' | 'trailing'>;

/**
 * A {@link TextField} for passwords with a show/hide toggle. The toggle keeps the name "Show
 * password" and reports its state with `aria-pressed` (a toggle button's label never changes).
 * Pass the right `autoComplete` (`current-password` or `new-password`) so password managers
 * behave.
 */
export function PasswordField(props: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);
  return (
    <TextField
      {...props}
      type={visible ? 'text' : 'password'}
      spellCheck={false}
      autoCapitalize="none"
      trailing={
        <IconButton
          label="Show password"
          size="sm"
          aria-pressed={visible}
          onClick={() => {
            setVisible((current) => !current);
          }}
        >
          {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </IconButton>
      }
    />
  );
}
