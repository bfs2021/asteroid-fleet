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
  it('toasts a failed slot write once, as a warning', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const local = new Map<string, string>([[ACTIVE_SLOT_KEY, '2']]);
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => local.get(key) ?? null,
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: (key: string) => local.delete(key),
    });
    engine.toasts.clear();
    engine.replace(newGame(3));
    const toast = engine.toasts.shown().find((t) => t.text.includes('save slot 2'));
    expect(toast).toMatchObject({ severity: 'warn', carrierId: null });
    engine.toasts.clear();
    engine.replace(newGame(3));
    expect(engine.toasts.shown().some((t) => t.text.includes('save slot 2'))).toBe(false);
    vi.unstubAllGlobals();
    engine.toasts.clear();
  });
});

describe('toast Go to', () => {
  it('focuses the event carrier and closes the toast', () => {
    engine.toasts.clear();
    const previous = engine.state.ops;
    const extra = { ...previous[0], id: 6 };
    engine.state.ops = [...previous, extra];
    const key = engine.toasts.push({
      eventId: 4,
      text: 'Warped to Lumen.',
      severity: 'good',
      carrierId: 6,
    });
    engine.goToToast(key);
    expect(engine.focusedCarrierId).toBe(6);
    expect(engine.toasts.shown()).toEqual([]);
    engine.state.ops = previous;
    engine.focusCarrier(previous[0].id);
    expect(engine.focusedCarrierId).toBe(previous[0].id);
    engine.toasts.clear();
  });

  it('closes a toast for the only carrier without leaving the focus unset', () => {
    engine.toasts.clear();
    const id = engine.state.ops[0].id;
    const key = engine.toasts.push({
      eventId: 8,
      text: 'Pirates have arrived!',
      severity: 'critical',
      carrierId: id,
    });
    engine.goToToast(key);
    expect(engine.focusedCarrierId).toBe(id);
    expect(engine.toasts.shown()).toEqual([]);
  });
});
