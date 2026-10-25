import { get, set } from 'idb-keyval';
import type { GameState } from '../sim/types';
import { migrate, type SaveFailure } from './migrate';

export const SAVE_KEY = 'asteroid-fleet-save';
export const SAVE_BACKUP_KEY = 'asteroid-fleet-save-backup';

export const SAVE_BACKUP_NOTICE = 'Your save could not be loaded and was backed up.';

export type LoadResult =
  | { ok: true; state: GameState }
  | { ok: false; reason: 'empty' }
  | { ok: false; reason: SaveFailure; notice: string };

/**
 * True after an unknown, newer, or corrupt save was read. Autosave must not
 * replace that slot; the raw text lives on under `SAVE_BACKUP_KEY` as well.
 */
let preservePrimary = false;

export function saveOverwriteBlocked(): boolean {
  return preservePrimary;
}

/** Player explicitly started a new game or imported one. Does not delete the backup. */
export function allowSaveOverwrite(): void {
  preservePrimary = false;
}

async function writeStore(key: string, json: string): Promise<void> {
  try {
    await set(key, json);
  } catch {
    /* IndexedDB unavailable (private mode); localStorage write below still runs */
  }
  try {
    localStorage.setItem(key, json);
  } catch {
    /* storage full or blocked */
  }
}

async function readPrimary(): Promise<string | null> {
  try {
    const fromIdb = await get<unknown>(SAVE_KEY);
    if (typeof fromIdb === 'string' && fromIdb) return fromIdb;
  } catch {
    /* IndexedDB unavailable (private mode); fall back below */
  }
  try {
    const fromLocal = localStorage.getItem(SAVE_KEY);
    if (fromLocal) return fromLocal;
  } catch {
    /* storage blocked */
  }
  return null;
}

async function backupRaw(json: string): Promise<void> {
  // Lock before the first await so a save kicked off mid-backup cannot land first.
  preservePrimary = true;
  await writeStore(SAVE_BACKUP_KEY, json);
}

export async function saveGame(state: GameState): Promise<boolean> {
  if (preservePrimary) return false;
  await writeStore(SAVE_KEY, JSON.stringify(state));
  return true;
}

export async function loadGame(): Promise<LoadResult> {
  const json = await readPrimary();
  if (json === null) {
    preservePrimary = false;
    return { ok: false, reason: 'empty' };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    await backupRaw(json);
    return { ok: false, reason: 'corrupt', notice: SAVE_BACKUP_NOTICE };
  }

  const migrated = migrate(raw);
  if (!migrated.ok) {
    await backupRaw(json);
    return { ok: false, reason: migrated.reason, notice: SAVE_BACKUP_NOTICE };
  }

  preservePrimary = false;
  return migrated;
}

export function exportSave(state: GameState): string {
  return btoa(unescape(encodeURIComponent(JSON.stringify(state))));
}

/** Same migrate-and-validate path as a stored save. A bad paste does not touch storage. */
export function importSave(text: string): GameState | null {
  try {
    const raw: unknown = JSON.parse(decodeURIComponent(escape(atob(text.trim()))));
    const migrated = migrate(raw);
    return migrated.ok ? migrated.state : null;
  } catch {
    return null;
  }
}
