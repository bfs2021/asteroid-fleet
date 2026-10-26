import { describe, expect, it } from 'vitest';
import { DOUBLE_CLICK_MS, easeFactor, focus, isDoubleMiss, resolveFocus } from './focus';

const ships = (...m: [number, string][]) => ({
  ships: m.map(([id, mode]) => ({ id, mode })) as never,
});

describe('resolveFocus', () => {
  it('keeps live ships', () => expect(resolveFocus(ships([1, 'mining']), 1)).toBe(1));
  it('falls back when docked', () => expect(resolveFocus(ships([1, 'docked']), 1)).toBeNull());
  it('falls back when destroyed', () => expect(resolveFocus(ships([2, 'idle']), 1)).toBeNull());
  it('null stays null', () => expect(resolveFocus(ships(), null)).toBeNull());
});

describe('isDoubleMiss', () => {
  it('detects two quick misses once', () => {
    expect(isDoubleMiss(10_000)).toBe(false);
    expect(isDoubleMiss(10_000 + DOUBLE_CLICK_MS - 1)).toBe(true);
    expect(isDoubleMiss(10_000 + DOUBLE_CLICK_MS)).toBe(false);
  });
  it('ignores slow clicks', () => {
    expect(isDoubleMiss(50_000)).toBe(false);
    expect(isDoubleMiss(60_000)).toBe(false);
  });
});

describe('easeFactor', () => {
  it('is 0..1 and monotonic', () => {
    expect(easeFactor(0, 8)).toBe(0);
    expect(easeFactor(0.1, 8)).toBeGreaterThan(0);
    expect(easeFactor(10, 8)).toBeLessThan(1.0000001);
  });
});

describe('focus store', () => {
  it('notifies on change only', () => {
    let n = 0;
    const off = focus.subscribe(() => n++);
    focus.set(5);
    focus.set(5);
    focus.set(null);
    off();
    expect(n).toBe(2);
  });
});
