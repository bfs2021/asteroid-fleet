import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadFile } from './download';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('downloadFile', () => {
  it('revokes the object URL only after the click has been handled', () => {
    vi.useFakeTimers();
    const click = vi.fn<() => void>();
    const revoke = vi.fn<(url: string) => void>();
    vi.stubGlobal('document', { createElement: () => ({ click }) });
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:x', revokeObjectURL: revoke });
    downloadFile('save.json', '{}', 'application/json');
    expect(click).toHaveBeenCalledOnce();
    expect(revoke).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(revoke).toHaveBeenCalledWith('blob:x');
  });
});
