import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { TextArea } from './TextArea';

describe('TextArea', () => {
  it('counts characters when uncontrolled', async () => {
    render(<TextArea label="Note" maxLength={280} showCount defaultValue="hi" />);

    const textarea = screen.getByRole('textbox', { name: 'Note' });
    expect(screen.getByText(/2 \/ 280/)).toBeInTheDocument();
    expect(textarea).toHaveAccessibleDescription('2 of 280 characters used');

    await userEvent.type(textarea, '!!');
    expect(screen.getByText(/4 \/ 280/)).toBeInTheDocument();
  });

  it('counts characters when controlled', async () => {
    function Controlled() {
      const [value, setValue] = useState('');
      return (
        <TextArea
          label="Bio"
          maxLength={10}
          showCount
          hint="Shown under your name."
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
          }}
        />
      );
    }
    render(<Controlled />);

    const textarea = screen.getByRole('textbox', { name: 'Bio' });
    await userEvent.type(textarea, 'abc');
    expect(screen.getByText(/3 \/ 10/)).toBeInTheDocument();
    expect(textarea).toHaveAccessibleDescription('Shown under your name. 3 of 10 characters used');
  });

  it('omits the counter without maxLength and shows errors', () => {
    render(<TextArea label="Note" showCount error="Too long." rows={2} />);

    const textarea = screen.getByRole('textbox', { name: 'Note' });
    expect(textarea).toHaveAttribute('rows', '2');
    expect(textarea).toHaveAttribute('aria-invalid', 'true');
    expect(textarea).toHaveAccessibleDescription('Too long.');
    expect(screen.queryByText(/characters used/)).not.toBeInTheDocument();
  });

  it('counts an array value like the DOM does', () => {
    render(<TextArea label="Note" maxLength={20} showCount value={['a', 'b']} readOnly />);

    expect(screen.getByText(/3 \/ 20/)).toBeInTheDocument();
  });
});
