import { describe, expect, it, vi } from 'vitest';
import { newGame } from '../sim/state';
import { engine } from './engine';

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
