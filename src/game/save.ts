import { entries, get, set } from 'idb-keyval';
import type { GameState } from '../sim/types';
import { migrate, type SaveFailure } from './migrate';

export const SAVE_KEY = 'asteroid-fleet-save';
export const SAVE_BACKUP_KEY = 'asteroid-fleet-save-backup';

export const SAVE_BACKUP_NOTICE = 'Your save could not be loaded and was backed up.';
export const SAVE_BACKUP_FAILED_NOTICE =
  'Your save could not be loaded and could not be backed up.';

export type LoadResult =
  | { ok: true; state: GameState }
  | { ok: false; reason: 'empty' }
  | { ok: false; reason: SaveFailure; notice: string; backedUp: boolean };

/**
 * True after an unknown, newer, or corrupt save was read. Autosave must not
 * replace that slot. A copy lives under a backup key when the write succeeded.
 */
let preservePrimary = false;

export function saveOverwriteBlocked(): boolean {
  return preservePrimary;
}

/** Player explicitly started a new game or imported one. Does not delete backups. */
export function allowSaveOverwrite(): void {
  preservePrimary = false;
}

export function isBackupKey(key: string): boolean {
  return key === SAVE_BACKUP_KEY || key.startsWith(`${SAVE_BACKUP_KEY}-`);
}

/**
 * At least one store kept the bytes. A read-back guards a write that did not stick.
 * `mirror: false` skips localStorage once IndexedDB holds the bytes, so timestamped
 * backups cannot crowd out the primary copy kept there.
 */
async function writeStore(key: string, json: string, mirror = true): Promise<boolean> {
  let idbOk = false;
  try {
    await set(key, json);
    idbOk = (await get<unknown>(key)) === json;
  } catch {
    idbOk = false;
  }
  if (idbOk && !mirror) return true;
  let localOk = false;
  try {
    localStorage.setItem(key, json);
    localOk = localStorage.getItem(key) === json;
  } catch {
    localOk = false;
  }
  return idbOk || localOk;
}

/**
 * Text for a non-string IndexedDB value so it can be backed up. Bytes decode as UTF-8,
 * other values use JSON, and anything JSON cannot hold (functions, BigInt, symbols)
 * falls back to `String`. The fallback is lossy, so it is only ever kept as corrupt data.
 */
function textFromUnknown(value: unknown): string {
  if (value instanceof ArrayBuffer) return new TextDecoder().decode(value);
  if (ArrayBuffer.isView(value)) {
    return new TextDecoder().decode(
      new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
    );
  }
  try {
    const text = JSON.stringify(value);
    if (typeof text === 'string') return text;
  } catch {
    /* not JSON; fall through */
  }
  return String(value);
}

async function readPrimary(): Promise<{ text: string; forceCorrupt: boolean } | null> {
  try {
    const fromIdb = await get<unknown>(SAVE_KEY);
    if (typeof fromIdb === 'string' && fromIdb) return { text: fromIdb, forceCorrupt: false };
    // A non-string value is not "no save". Back it up as corrupt instead of
    // falling through and later overwriting it with a fresh game.
    if (fromIdb !== undefined && fromIdb !== null) {
      return { text: textFromUnknown(fromIdb), forceCorrupt: true };
    }
  } catch {
    /* IndexedDB unavailable (private mode); fall back below */
  }
  try {
    const fromLocal = localStorage.getItem(SAVE_KEY);
    if (fromLocal) return { text: fromLocal, forceCorrupt: false };
  } catch {
    /* storage blocked */
  }
  return null;
}

/**
 * The raw primary save as stored, for the "download unreadable save" escape hatch.
 * Returns null when there is nothing stored.
 */
export async function readPrimaryText(): Promise<string | null> {
  return (await readPrimary())?.text ?? null;
}

async function eachBackup(onValue: (key: string, value: unknown) => void): Promise<void> {
  try {
    for (const [key, value] of await entries<string, unknown>()) {
      if (typeof key === 'string') onValue(key, value);
    }
  } catch {
    /* IndexedDB unavailable */
  }
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      onValue(key, localStorage.getItem(key));
    }
  } catch {
    /* storage blocked */
  }
}

/** Every distinct backup blob. The same key and text in both stores counts once. */
export async function readBackups(): Promise<{ key: string; text: string }[]> {
  const out: { key: string; text: string }[] = [];
  const seen = new Set<string>();
  await eachBackup((key, value) => {
    if (!isBackupKey(key) || typeof value !== 'string') return;
    const id = `${key}\0${value}`;
    if (seen.has(id)) return;
    seen.add(id);
    out.push({ key, text: value });
  });
  return out;
}

/**
 * Canonical key when it is free. A byte-identical copy already on disk returns
 * null so we do not rewrite it. A different earlier backup is left in place and
 * this one goes to `asteroid-fleet-save-backup-<timestamp>`.
 */
async function chooseBackupKey(json: string): Promise<string | null> {
  const used = new Set<string>();
  const texts = new Set<string>();
  await eachBackup((key, value) => {
    if (!isBackupKey(key)) return;
    used.add(key);
    if (typeof value === 'string') texts.add(value);
  });
  if (texts.has(json)) return null;
  if (!used.has(SAVE_BACKUP_KEY)) return SAVE_BACKUP_KEY;
  let stamp = Date.now();
  let key = `${SAVE_BACKUP_KEY}-${stamp}`;
  while (used.has(key)) {
    stamp += 1;
    key = `${SAVE_BACKUP_KEY}-${stamp}`;
  }
  return key;
}

async function backupRaw(json: string): Promise<boolean> {
  // Lock before the first await so a save kicked off mid-backup cannot land first.
  preservePrimary = true;
  const key = await chooseBackupKey(json);
  if (key === null) return true;
  return writeStore(key, json, key === SAVE_BACKUP_KEY);
}

function unreadable(reason: SaveFailure, backedUp: boolean): LoadResult {
  return {
    ok: false,
    reason,
    backedUp,
    notice: backedUp ? SAVE_BACKUP_NOTICE : SAVE_BACKUP_FAILED_NOTICE,
  };
}

export async function saveGame(state: GameState): Promise<boolean> {
  if (preservePrimary) return false;
  await writeStore(SAVE_KEY, JSON.stringify(state));
  return true;
}

export async function loadGame(): Promise<LoadResult> {
  const stored = await readPrimary();
  if (!stored) {
    preservePrimary = false;
    return { ok: false, reason: 'empty' };
  }

  if (stored.forceCorrupt) {
    return unreadable('corrupt', await backupRaw(stored.text));
  }

  let raw: unknown;
  try {
    raw = JSON.parse(stored.text);
  } catch {
    return unreadable('corrupt', await backupRaw(stored.text));
  }

  const migrated = migrate(raw);
  if (!migrated.ok) return unreadable(migrated.reason, await backupRaw(stored.text));

  preservePrimary = false;
  return migrated;
}

export function exportSave(state: GameState): string {
  return btoa(unescape(encodeURIComponent(JSON.stringify(state))));
}

export type DecodeResult = { ok: true; state: GameState } | { ok: false; error: string };

const DECODE_ERRORS: Record<SaveFailure, string> = {
  corrupt: 'That save is damaged or incomplete.',
  newer: 'That save comes from a newer version of the game. Update the game to load it.',
  unknown: 'That save has a version this game does not recognise.',
};

/**
 * Accepts an exported text save (base64) or a save file (plain JSON).
 * Old versions go through `migrate`, the same path as a stored save.
 */
export function decodeSave(text: string): DecodeResult {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, error: 'Paste a save first.' };
  let raw: unknown;
  try {
    raw = JSON.parse(trimmed.startsWith('{') ? trimmed : decodeURIComponent(escape(atob(trimmed))));
  } catch {
    return { ok: false, error: 'That is not a save: it could not be decoded.' };
  }
  const migrated = migrate(raw);
  return migrated.ok ? migrated : { ok: false, error: DECODE_ERRORS[migrated.reason] };
}

/** Pretty JSON for the `.json` download. `decodeSave` reads it back. */
export function exportSaveFile(state: GameState): string {
  return JSON.stringify(state, null, 2);
}

/** Same migrate-and-validate path as a stored save. A bad paste does not touch storage. */
export function importSave(text: string): GameState | null {
  const decoded = decodeSave(text);
  return decoded.ok ? decoded.state : null;
}
