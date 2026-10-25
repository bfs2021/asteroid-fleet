import { SAVE_VERSION } from '../sim/state';
import type { GameState } from '../sim/types';

export type SaveFailure = 'corrupt' | 'newer' | 'unknown';

export type MigrateResult = { ok: true; state: GameState } | { ok: false; reason: SaveFailure };

/** Plain JSON object a migration step reads and returns. */
export type SaveBlob = Record<string, unknown>;

/**
 * Upgrades a version-n save to version n+1.
 * The step may mutate `save` or return a new object. The runner stamps `version`.
 */
export type Migration = (save: SaveBlob) => SaveBlob;

/**
 * One step per version, applied in order.
 * `migrations[n]` upgrades a version-n save to version n+1, up to `SAVE_VERSION`.
 * A gap (no step for a version this build claims to support) is an unknown save:
 * callers back that up instead of dropping it.
 */
export const migrations: Record<number, Migration> = {};

export function applyMigrationSteps(
  save: SaveBlob,
  fromVersion: number,
  toVersion: number,
  steps: Record<number, Migration> = migrations,
): SaveBlob | null {
  let current = save;
  for (let version = fromVersion; version < toVersion; version++) {
    const step = steps[version];
    if (!step) return null;
    const next = step(current);
    if (!next || typeof next !== 'object' || Array.isArray(next)) return null;
    next.version = version + 1;
    current = next;
  }
  return current;
}

/** Migrate `raw` to `SAVE_VERSION`, then check the fields a save must have. */
export function migrate(raw: unknown): MigrateResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reason: 'corrupt' };
  }

  let save: SaveBlob;
  try {
    save = structuredClone(raw) as SaveBlob;
  } catch {
    return { ok: false, reason: 'corrupt' };
  }

  const version = save.version;
  if (typeof version !== 'number' || !Number.isInteger(version)) {
    return { ok: false, reason: 'unknown' };
  }
  if (version > SAVE_VERSION) return { ok: false, reason: 'newer' };
  if (version < 1) return { ok: false, reason: 'unknown' };

  const migrated = applyMigrationSteps(save, version, SAVE_VERSION);
  if (!migrated) return { ok: false, reason: 'unknown' };
  return validateSave(migrated);
}

function validateSave(save: SaveBlob): MigrateResult {
  if (save.version !== SAVE_VERSION) return { ok: false, reason: 'corrupt' };
  if (!Array.isArray(save.ships)) return { ok: false, reason: 'corrupt' };
  if (!save.carrier || typeof save.carrier !== 'object' || Array.isArray(save.carrier)) {
    return { ok: false, reason: 'corrupt' };
  }
  if (!save.wave || typeof save.wave !== 'object' || Array.isArray(save.wave)) {
    return { ok: false, reason: 'corrupt' };
  }
  if (!save.storm || typeof save.storm !== 'object' || Array.isArray(save.storm)) {
    return { ok: false, reason: 'corrupt' };
  }

  const state = save as unknown as GameState;
  // JSON turns Infinity into null; restore "no timer".
  if (state.wave.timer === null) state.wave.timer = Infinity;
  if (state.storm.timer === null) state.storm.timer = Infinity;
  return { ok: true, state };
}
