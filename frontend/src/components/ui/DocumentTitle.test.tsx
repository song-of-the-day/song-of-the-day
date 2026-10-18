import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { APP_NAME, DocumentTitle } from './DocumentTitle';

describe('DocumentTitle', () => {
  it('sets the document title while mounted', () => {
    const { rerender } = render(<DocumentTitle title="Log in" />);
    expect(document.title).toBe(`Log in · ${APP_NAME}`);

    rerender(<DocumentTitle />);
    expect(document.title).toBe(APP_NAME);
  });
});
