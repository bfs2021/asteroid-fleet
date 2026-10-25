import { get, set } from 'idb-keyval';
import { SAVE_VERSION } from '../sim/state';
import type { GameState } from '../sim/types';

const KEY = 'asteroid-fleet-save';

function revive(raw: unknown): GameState | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as GameState;
  if (s.version !== SAVE_VERSION || !Array.isArray(s.ships) || !s.carrier) return null;
  // JSON turns Infinity into null; restore "no timer".
  if (s.wave.timer === null) s.wave.timer = Infinity;
  if (s.storm.timer === null) s.storm.timer = Infinity;
  return s;
}

export async function saveGame(s: GameState) {
  const json = JSON.stringify(s);
  try {
    await set(KEY, json);
  } catch {
    /* IndexedDB unavailable (private mode); fall back below */
  }
  try {
    localStorage.setItem(KEY, json);
  } catch {
    /* storage full or blocked */
  }
}

export async function loadGame(): Promise<GameState | null> {
  let json: string | undefined | null;
  try {
    json = await get<string>(KEY);
  } catch {
    json = null;
  }
  if (!json) {
    try {
      json = localStorage.getItem(KEY);
    } catch {
      json = null;
    }
  }
  if (!json) return null;
  try {
    return revive(JSON.parse(json));
  } catch {
    return null;
  }
}

export function exportSave(s: GameState): string {
  return btoa(unescape(encodeURIComponent(JSON.stringify(s))));
}

export function importSave(text: string): GameState | null {
  try {
    return revive(JSON.parse(decodeURIComponent(escape(atob(text.trim())))));
  } catch {
    return null;
  }
}
