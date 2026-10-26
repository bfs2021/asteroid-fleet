import { afterEach, describe, expect, it, vi } from 'vitest';
import { engine } from '../game/engine';
import { confirmReplace } from './Settings';

afterEach(() => {
  engine.saveBackupFailed = false;
  vi.unstubAllGlobals();
});

describe('replace confirms', () => {
  it('warns that an unbacked-up save will be lost while the backup-failed state is up', () => {
    const ask = vi.fn<(msg: string) => boolean>(() => true);
    vi.stubGlobal('confirm', ask);
    engine.saveBackupFailed = true;
    expect(confirmReplace('Import this save?')).toBe(true);
    expect(ask.mock.calls[0][0]).toContain('could not be backed up and will be lost');
  });

  it('uses the slot warning when the backup succeeded', () => {
    const ask = vi.fn<(msg: string) => boolean>(() => false);
    vi.stubGlobal('confirm', ask);
    engine.saveBackupFailed = false;
    expect(confirmReplace('Import this save?')).toBe(false);
    expect(ask.mock.calls[0][0]).toContain('unless it is saved in a slot');
  });
});
