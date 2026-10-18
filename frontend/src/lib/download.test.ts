import { afterEach, describe, expect, it, vi } from 'vitest';

import { saveBlob } from './download';

describe('saveBlob', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('clicks a temporary download link and revokes the object URL afterwards', () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const createObjectURL = vi.fn(() => 'blob:fake');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL }));
    const clicked: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push(this);
    });
    const blob = new Blob(['{}'], { type: 'application/json' });

    saveBlob(blob, 'sotd-export-2026-10-11.json');

    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(clicked).toHaveLength(1);
    expect(clicked[0]?.download).toBe('sotd-export-2026-10-11.json');
    expect(clicked[0]?.href).toBe('blob:fake');
    expect(document.querySelector('a')).toBeNull();
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake');
  });
});
