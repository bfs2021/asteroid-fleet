import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SAVE_VERSION, newGame } from '../sim/state';
import saveV1 from './fixtures/save-v1.json';
import saveV2 from './fixtures/save-v2.json';
import { applyMigrationSteps, migrate, type SaveBlob } from './migrate';
import {
  SAVE_BACKUP_FAILED_NOTICE,
  SAVE_BACKUP_KEY,
  SAVE_BACKUP_NOTICE,
  SAVE_KEY,
  allowSaveOverwrite,
  decodeSave,
  exportSave,
  exportSaveFile,
  importSave,
  loadGame,
  readBackups,
  readPrimaryText,
  saveGame,
  saveOverwriteBlocked,
  type LoadResult,
} from './save';

const mem = vi.hoisted(() => ({
  idb: new Map<string, unknown>(),
  fail: false,
}));

vi.mock('idb-keyval', () => ({
  get: vi.fn<(key: string) => Promise<unknown>>(async (key) => {
    if (mem.fail) throw new Error('indexedDB unavailable');
    return mem.idb.get(key);
  }),
  set: vi.fn<(key: string, value: string) => Promise<void>>(async (key, value) => {
    if (mem.fail) throw new Error('indexedDB unavailable');
    mem.idb.set(key, value);
  }),
  entries: vi.fn<() => Promise<[string, unknown][]>>(async () => {
    if (mem.fail) throw new Error('indexedDB unavailable');
    return [...mem.idb.entries()];
  }),
}));

let local: Map<string, string>;

function installLocalStorage(options?: { rejectWrites?: boolean }) {
  local = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => (local.has(key) ? local.get(key)! : null),
    setItem: (key: string, value: string) => {
      if (options?.rejectWrites) throw new Error('quota');
      local.set(key, value);
    },
    removeItem: (key: string) => {
      local.delete(key);
    },
    clear: () => local.clear(),
    key: (index: number) => [...local.keys()][index] ?? null,
    get length() {
      return local.size;
    },
  });
}

beforeEach(() => {
  mem.idb.clear();
  mem.fail = false;
  installLocalStorage();
  allowSaveOverwrite();
});

function encodeRaw(raw: unknown): string {
  return btoa(unescape(encodeURIComponent(JSON.stringify(raw))));
}

describe('migrate', () => {
  it('migrates a checked-in v1 fixture to the current version', () => {
    expect(saveV1.version).toBe(1);
    const result = migrate(saveV1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.version).toBe(SAVE_VERSION);
    expect(result.state.credits).toBe(420);
    expect(result.state.seed).toBe(1337);
    expect(result.state.ships).toHaveLength(1);
    expect(result.state.ships[0].cargo).toBe(6);
    expect(result.state.carrier.hull).toBe(1800);
    expect(result.state.stats.oreValueDelivered).toBe(500);
    expect(result.state.researchLevels.yield).toBe(1);
    expect(result.state.powerMode).toBe('income');
    expect(result.state.wave.timer).toBe(Infinity);
    expect(result.state.storm.timer).toBe(Infinity);
    expect(result.state.automation).toEqual({
      autoBuy: false,
      autoRebuild: false,
      creditFloor: 0,
      rebuildQueue: [],
      timer: 0,
    });
    for (const h of result.state.hangars) expect(h.target).toEqual({});
    // The fixture module itself stays a v1 document.
    expect(saveV1.version).toBe(1);
    expect(saveV1.wave.timer).toBeNull();
  });

  it('migrates v1 and v2 saves to v3 with empty depletion records', () => {
    const fromV1 = migrate(saveV1);
    expect(fromV1.ok && fromV1.state.fields).toEqual({});
    expect(fromV1.ok && fromV1.state.automation.autoBuy).toBe(false);
    expect(saveV2.version).toBe(2);
    const fromV2 = migrate(saveV2);
    expect(fromV2.ok).toBe(true);
    if (!fromV2.ok) return;
    expect(fromV2.state.version).toBe(SAVE_VERSION);
    expect(fromV2.state.fields).toEqual({});
    expect(fromV2.state.automation.autoRebuild).toBe(true);
    expect(fromV2.state.automation.creditFloor).toBe(100);
  });

  it('applies one migration step per version, in order', () => {
    const seen: number[] = [];
    const steps: Record<number, (save: SaveBlob) => SaveBlob> = {
      1: (save) => {
        seen.push(save.version as number);
        save.a = 1;
        return save;
      },
      2: (save) => {
        seen.push(save.version as number);
        save.b = (save.a as number) + 1;
        return save;
      },
    };
    const out = applyMigrationSteps({ version: 1 }, 1, 3, steps);
    expect(seen).toEqual([1, 2]);
    expect(out).toMatchObject({ version: 3, a: 1, b: 2 });
    expect(applyMigrationSteps({ version: 1 }, 1, 3, { 1: (save) => save })).toBeNull();
  });

  it('rejects a version that is not a positive integer, and non-objects', () => {
    expect(migrate({ version: 0 })).toEqual({ ok: false, reason: 'unknown' });
    expect(migrate({ version: -2 })).toEqual({ ok: false, reason: 'unknown' });
    expect(migrate({ version: 1.5 })).toEqual({ ok: false, reason: 'unknown' });
    expect(migrate({ version: '1' })).toEqual({ ok: false, reason: 'unknown' });
    expect(migrate(null)).toEqual({ ok: false, reason: 'corrupt' });
    expect(migrate([])).toEqual({ ok: false, reason: 'corrupt' });
    expect(migrate('save')).toEqual({ ok: false, reason: 'corrupt' });
  });
});

function unreadable(result: LoadResult): Extract<LoadResult, { backedUp: boolean }> {
  if (result.ok || result.reason === 'empty') throw new Error('expected an unreadable save');
  return result;
}

async function expectPreserved(
  raw: string,
  reason: 'corrupt' | 'newer' | 'unknown',
): Promise<Extract<LoadResult, { ok: false }>> {
  mem.idb.set(SAVE_KEY, raw);
  local.set(SAVE_KEY, raw);
  const loaded = await loadGame();
  expect(loaded).toEqual({ ok: false, reason, notice: SAVE_BACKUP_NOTICE, backedUp: true });
  expect(mem.idb.get(SAVE_KEY)).toBe(raw);
  expect(local.get(SAVE_KEY)).toBe(raw);
  expect(mem.idb.get(SAVE_BACKUP_KEY)).toBe(raw);
  expect(local.get(SAVE_BACKUP_KEY)).toBe(raw);
  expect(saveOverwriteBlocked()).toBe(true);
  expect(await saveGame(newGame(1))).toBe(false);
  expect(mem.idb.get(SAVE_KEY)).toBe(raw);
  expect(local.get(SAVE_KEY)).toBe(raw);
  expect(mem.idb.get(SAVE_BACKUP_KEY)).toBe(raw);
  expect(local.get(SAVE_BACKUP_KEY)).toBe(raw);
  if (loaded.ok) throw new Error('expected the save to be preserved');
  return loaded;
}

describe('unreadable saves', () => {
  it('backs up a corrupt save and does not delete or overwrite it', async () => {
    const loaded = await expectPreserved('{"version":1,"ships":', 'corrupt');
    expect(loaded.reason).toBe('corrupt');
  });

  it('backs up a save that fails validation and does not delete it', async () => {
    const loaded = await expectPreserved(JSON.stringify({ version: 1, carrier: null }), 'corrupt');
    expect(loaded.reason).toBe('corrupt');
  });

  it('backs up a newer-version save and does not delete or overwrite it', async () => {
    const loaded = await expectPreserved(
      JSON.stringify({ ...saveV1, version: SAVE_VERSION + 1 }),
      'newer',
    );
    expect(loaded.reason).toBe('newer');
  });

  it('backs up an unknown save and does not delete it', async () => {
    const loaded = await expectPreserved(
      JSON.stringify({ credits: 10, ships: [], carrier: {} }),
      'unknown',
    );
    expect(loaded.reason).toBe('unknown');
  });

  it('copies a localStorage-only corrupt save into both backup stores', async () => {
    const raw = '{"version":1,';
    local.set(SAVE_KEY, raw);
    const loaded = await loadGame();
    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.reason).toBe('corrupt');
    expect(local.get(SAVE_KEY)).toBe(raw);
    expect(local.get(SAVE_BACKUP_KEY)).toBe(raw);
    expect(mem.idb.has(SAVE_KEY)).toBe(false);
    expect(mem.idb.get(SAVE_BACKUP_KEY)).toBe(raw);
    expect(await saveGame(newGame(3))).toBe(false);
    expect(mem.idb.has(SAVE_KEY)).toBe(false);
    expect(local.get(SAVE_KEY)).toBe(raw);
  });

  it('backs up a corrupt localStorage save when IndexedDB is unavailable', async () => {
    mem.fail = true;
    const raw = '{"nope"';
    local.set(SAVE_KEY, raw);
    const loaded = await loadGame();
    expect(loaded).toEqual({
      ok: false,
      reason: 'corrupt',
      notice: SAVE_BACKUP_NOTICE,
      backedUp: true,
    });
    expect(local.get(SAVE_KEY)).toBe(raw);
    expect(local.get(SAVE_BACKUP_KEY)).toBe(raw);
    expect(mem.idb.has(SAVE_KEY)).toBe(false);
    expect(mem.idb.has(SAVE_BACKUP_KEY)).toBe(false);
    expect(await saveGame(newGame(2))).toBe(false);
    expect(local.get(SAVE_KEY)).toBe(raw);
  });

  it('keeps an earlier backup when a later failed load is different', async () => {
    const first = '{"broken-a"';
    const second = '{"broken-b"';
    mem.idb.set(SAVE_KEY, first);
    local.set(SAVE_KEY, first);
    expect(unreadable(await loadGame()).backedUp).toBe(true);
    expect(mem.idb.get(SAVE_BACKUP_KEY)).toBe(first);
    expect(local.get(SAVE_BACKUP_KEY)).toBe(first);

    allowSaveOverwrite();
    expect(await saveGame(newGame(9))).toBe(true);

    mem.idb.set(SAVE_KEY, second);
    local.set(SAVE_KEY, second);
    expect(unreadable(await loadGame()).backedUp).toBe(true);
    expect(mem.idb.get(SAVE_KEY)).toBe(second);
    expect(local.get(SAVE_KEY)).toBe(second);
    expect(mem.idb.get(SAVE_BACKUP_KEY)).toBe(first);
    expect(local.get(SAVE_BACKUP_KEY)).toBe(first);
    const extras = [...mem.idb.keys()].filter(
      (key) => key.startsWith(`${SAVE_BACKUP_KEY}-`) && mem.idb.get(key) === second,
    );
    expect(extras).toHaveLength(1);
    // Timestamped backups live only in IndexedDB when it accepted the write.
    expect(local.has(extras[0])).toBe(false);
    const stored = await readBackups();
    expect(stored.map((entry) => entry.text).sort()).toEqual([first, second].sort());
  });

  it('reads the raw primary for the unreadable-save download, from either store', async () => {
    expect(await readPrimaryText()).toBeNull();
    local.set(SAVE_KEY, '{"local"');
    expect(await readPrimaryText()).toBe('{"local"');
    mem.idb.set(SAVE_KEY, '{"idb"');
    expect(await readPrimaryText()).toBe('{"idb"');
  });

  it('keeps bytes from a non-JSON IndexedDB value instead of a bare [object] string', async () => {
    mem.idb.set(SAVE_KEY, new TextEncoder().encode('{"bytes"').buffer);
    const loaded = unreadable(await loadGame());
    expect(loaded.backedUp).toBe(true);
    expect(mem.idb.get(SAVE_BACKUP_KEY)).toBe('{"bytes"');
  });

  it('does not rewrite a backup that already holds the same bytes', async () => {
    const raw = '{"same"';
    mem.idb.set(SAVE_KEY, raw);
    local.set(SAVE_KEY, raw);
    await loadGame();
    allowSaveOverwrite();
    expect(await saveGame(newGame(4))).toBe(true);
    mem.idb.set(SAVE_KEY, raw);
    local.set(SAVE_KEY, raw);
    await loadGame();
    const backupKeys = [...mem.idb.keys()].filter((key) => key.startsWith(SAVE_BACKUP_KEY));
    expect(backupKeys).toEqual([SAVE_BACKUP_KEY]);
    expect(mem.idb.get(SAVE_BACKUP_KEY)).toBe(raw);
    expect(local.get(SAVE_BACKUP_KEY)).toBe(raw);
  });

  it('does not claim a backup when IndexedDB and localStorage both reject the write', async () => {
    mem.fail = true;
    installLocalStorage({ rejectWrites: true });
    const raw = '{"nope"';
    local.set(SAVE_KEY, raw);
    const loaded = await loadGame();
    expect(loaded).toEqual({
      ok: false,
      reason: 'corrupt',
      notice: SAVE_BACKUP_FAILED_NOTICE,
      backedUp: false,
    });
    expect(local.get(SAVE_KEY)).toBe(raw);
    expect(local.has(SAVE_BACKUP_KEY)).toBe(false);
    expect(mem.idb.has(SAVE_BACKUP_KEY)).toBe(false);
    expect(mem.idb.has(SAVE_KEY)).toBe(false);
    expect(saveOverwriteBlocked()).toBe(true);
    expect(await saveGame(newGame(5))).toBe(false);
    expect(local.get(SAVE_KEY)).toBe(raw);
  });

  it('backs up a non-string IndexedDB value instead of treating it as empty', async () => {
    const value = { version: 1, credits: 99 };
    mem.idb.set(SAVE_KEY, value);
    const loaded = unreadable(await loadGame());
    expect(loaded.reason).toBe('corrupt');
    expect(loaded.backedUp).toBe(true);
    expect(mem.idb.get(SAVE_KEY)).toEqual(value);
    expect(mem.idb.get(SAVE_BACKUP_KEY)).toBe(JSON.stringify(value));
    expect(local.get(SAVE_BACKUP_KEY)).toBe(JSON.stringify(value));
    expect(await saveGame(newGame(6))).toBe(false);
    expect(mem.idb.get(SAVE_KEY)).toEqual(value);
  });
});

describe('export / import', () => {
  it('round-trips a current save through the migrate path', () => {
    const state = newGame(42);
    state.credits = 1234;
    state.stats.oreValueDelivered = 50;
    const copy = importSave(exportSave(state));
    expect(copy).not.toBeNull();
    expect(copy!.version).toBe(SAVE_VERSION);
    expect(copy!.credits).toBe(1234);
    expect(copy!.seed).toBe(42);
    expect(copy!.ships.map((ship) => ship.id)).toEqual(state.ships.map((ship) => ship.id));
    expect(copy!.stats.oreValueDelivered).toBe(50);
    expect(copy!.wave.timer).toBe(state.wave.timer);
    expect(copy!.storm.timer).toBe(state.storm.timer);
  });

  it('round-trips a numeric storm timer from a tier 2 system', () => {
    const state = newGame(8);
    const tier2 = state.systems.find((system) => system.tier >= 2);
    expect(tier2).toBeTruthy();
    state.systemId = tier2!.id;
    state.storm.timer = 27.5;
    state.wave.timer = 12;
    const copy = importSave(exportSave(state));
    expect(copy).not.toBeNull();
    expect(copy!.systemId).toBe(tier2!.id);
    expect(copy!.systems[copy!.systemId].tier).toBeGreaterThanOrEqual(2);
    expect(copy!.storm.timer).toBe(27.5);
    expect(copy!.wave.timer).toBe(12);
  });

  it('imports a v1 fixture through the same migrate path', () => {
    const copy = importSave(encodeRaw(saveV1));
    expect(copy).not.toBeNull();
    expect(copy!.version).toBe(SAVE_VERSION);
    expect(copy!.credits).toBe(saveV1.credits);
    expect(copy!.ships[0].cargo).toBe(saveV1.ships[0].cargo);
    expect(copy!.wave.timer).toBe(Infinity);
  });

  it('rejects a corrupt or newer import without touching storage', async () => {
    const raw = '{"version":1,"keep":true}';
    mem.idb.set(SAVE_KEY, raw);
    local.set(SAVE_KEY, raw);
    expect(importSave('not-a-save')).toBeNull();
    expect(importSave(encodeRaw({ version: SAVE_VERSION + 3, ships: [], carrier: {} }))).toBeNull();
    expect(mem.idb.get(SAVE_KEY)).toBe(raw);
    expect(local.get(SAVE_KEY)).toBe(raw);
    expect(mem.idb.has(SAVE_BACKUP_KEY)).toBe(false);
    expect(local.has(SAVE_BACKUP_KEY)).toBe(false);
    expect(saveOverwriteBlocked()).toBe(false);
  });
});

describe('loadGame', () => {
  it('loads a v1 save from IndexedDB without writing a backup', async () => {
    const raw = JSON.stringify(saveV1);
    mem.idb.set(SAVE_KEY, raw);
    const loaded = await loadGame();
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.state.version).toBe(SAVE_VERSION);
    expect(loaded.state.credits).toBe(420);
    expect(loaded.state.wave.timer).toBe(Infinity);
    expect(mem.idb.get(SAVE_KEY)).toBe(raw);
    expect(mem.idb.has(SAVE_BACKUP_KEY)).toBe(false);
    expect(local.has(SAVE_BACKUP_KEY)).toBe(false);
  });

  it('loads a v1 save from localStorage when IndexedDB is empty', async () => {
    local.set(SAVE_KEY, JSON.stringify(saveV1));
    const loaded = await loadGame();
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.state.version).toBe(SAVE_VERSION);
    expect(loaded.state.credits).toBe(420);
    expect(loaded.state.wave.timer).toBe(Infinity);
    expect(mem.idb.has(SAVE_BACKUP_KEY)).toBe(false);
    expect(local.has(SAVE_BACKUP_KEY)).toBe(false);
    expect(saveOverwriteBlocked()).toBe(false);
  });
});

function decodeError(text: string): string | null {
  const result = decodeSave(text);
  return result.ok ? null : result.error;
}

describe('decodeSave', () => {
  it('gives the same state from a text export and a file export', () => {
    const state = newGame(7);
    state.credits = 987;
    state.storm.timer = 3;
    const fromText = decodeSave(exportSave(state));
    const fromFile = decodeSave(exportSaveFile(state));
    expect(fromText.ok && fromFile.ok).toBe(true);
    if (!fromText.ok || !fromFile.ok) return;
    expect(fromFile.state).toEqual(fromText.state);
    expect(fromText.state.credits).toBe(987);
    expect(fromText.state.storm.timer).toBe(3);
    expect(fromText.state.wave.timer).toBe(state.wave.timer);
    expect(JSON.parse(exportSaveFile(fromFile.state))).toEqual(JSON.parse(exportSaveFile(state)));
  });

  it('migrates an old save file instead of rejecting it', () => {
    expect(decodeSave(JSON.stringify(saveV1))).toMatchObject({
      ok: true,
      state: { version: SAVE_VERSION },
    });
  });

  it('explains each kind of bad import', () => {
    const error = decodeError;
    expect(error('   ')).toMatch(/paste/i);
    expect(error('%%%not base64')).toMatch(/could not be decoded/);
    expect(error('{"version":1,')).toMatch(/could not be decoded/);
    expect(error(JSON.stringify({ version: SAVE_VERSION + 1 }))).toMatch(/newer version/);
    expect(error(JSON.stringify({ version: 'x' }))).toMatch(/does not recognise/);
    expect(error(encodeRaw({ version: SAVE_VERSION, ships: [] }))).toMatch(/damaged/);
    expect(error(encodeRaw([1, 2]))).toMatch(/damaged/);
  });
});
