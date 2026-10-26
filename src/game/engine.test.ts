import { describe, expect, it, vi } from 'vitest';
import { newGame } from '../sim/state';
import { engine } from './engine';
import { ACTIVE_SLOT_KEY } from './slots';

describe('engine.replace', () => {
  it('clears the backup-failed flag and the notice', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    engine.saveNotice = 'Your save could not be loaded and could not be backed up.';
    engine.saveBackupFailed = true;
    engine.replace(newGame(3));
    expect(engine.saveBackupFailed).toBe(false);
    expect(engine.saveNotice).toBeNull();
  });
});

describe('slot writes (#40)', () => {
  it('toasts once when the active slot cannot be written', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const local = new Map<string, string>([[ACTIVE_SLOT_KEY, '2']]);
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => local.get(key) ?? null,
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: (key: string) => local.delete(key),
    });
    engine.toast = null;
    engine.replace(newGame(3));
    expect(engine).toHaveProperty('toast.text', expect.stringContaining('save slot 2'));
    engine.toast = null;
    engine.replace(newGame(3));
    expect(engine.toast).toBeNull();
    vi.unstubAllGlobals();
  });
});
