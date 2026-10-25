import { beforeEach, describe, expect, it } from 'vitest';
import { newGame } from '../sim/state';
import saveV1 from './fixtures/save-v1.json';
import {
  ACTIVE_SLOT_KEY,
  SLOT_COUNT,
  deleteSlot,
  getActiveSlot,
  listSlots,
  readSlot,
  setActiveSlot,
  slotKey,
  writeSlot,
} from './slots';

function memoryStore() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
  };
}

let store: ReturnType<typeof memoryStore>;
beforeEach(() => {
  store = memoryStore();
});

describe('save slots', () => {
  it('starts with every slot empty', () => {
    const slots = listSlots(store);
    expect(slots).toHaveLength(SLOT_COUNT);
    expect(slots.every((s) => s.empty)).toBe(true);
  });

  it('writes, reads back and summarises a slot', () => {
    const state = newGame(3);
    state.credits = 4321;
    state.savedAt = 1_700_000_000_000;
    expect(writeSlot(2, state, store)).toBe(true);
    const read = readSlot(2, store);
    expect(read?.ok && read.state.credits).toBe(4321);
    const info = listSlots(store)[1];
    expect(info).toMatchObject({ slot: 2, empty: false, savedAt: 1_700_000_000_000 });
    expect('summary' in info && info.summary).toContain('4,321 credits');
    expect(listSlots(store)[0].empty).toBe(true);
  });

  it('rejects out-of-range slots', () => {
    expect(writeSlot(0, newGame(1), store)).toBe(false);
    expect(writeSlot(SLOT_COUNT + 1, newGame(1), store)).toBe(false);
    expect(store.map.size).toBe(0);
  });

  it('reports a corrupt slot instead of hiding it', () => {
    store.setItem(slotKey(1), '{oops');
    const info = listSlots(store)[0];
    expect(info.empty).toBe(false);
    expect('error' in info && info.error).toMatch(/could not be decoded/);
  });

  it('migrates an old-version slot', () => {
    store.setItem(slotKey(3), JSON.stringify(saveV1));
    const read = readSlot(3, store);
    expect(read?.ok).toBe(true);
  });

  it('deletes a slot and clears it as active', () => {
    writeSlot(1, newGame(1), store);
    setActiveSlot(1, store);
    expect(getActiveSlot(store)).toBe(1);
    deleteSlot(1, store);
    expect(listSlots(store)[0].empty).toBe(true);
    expect(getActiveSlot(store)).toBeNull();
  });

  it('ignores a bogus active slot value', () => {
    store.setItem(ACTIVE_SLOT_KEY, '9');
    expect(getActiveSlot(store)).toBeNull();
    setActiveSlot(2, store);
    expect(getActiveSlot(store)).toBe(2);
    setActiveSlot(null, store);
    expect(store.map.has(ACTIVE_SLOT_KEY)).toBe(false);
  });
});
