import { useSyncExternalStore } from 'react';

/** Player preferences. Stored apart from game saves, so import/reset never touch them. */
export const SETTINGS_KEY = 'asteroid-fleet-settings';
/** Pre-settings key for the quality toggle; read once as a fallback. */
const LEGACY_QUALITY_KEY = 'af-quality';

export type Settings = {
  uiScale: number;
  quality: 'high' | 'low';
  bloom: boolean;
  masterVolume: number;
  musicVolume: number;
  sfxVolume: number;
};

export const DEFAULT_SETTINGS: Settings = {
  uiScale: 1,
  quality: 'high',
  bloom: true,
  masterVolume: 0.8,
  musicVolume: 0.6,
  sfxVolume: 0.8,
};

export const UI_SCALES = [0.85, 1, 1.15, 1.3];

function clamp01(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback;
}

/** Keeps known, well-typed fields and fills the rest from defaults. */
export function parseSettings(raw: unknown): Settings {
  const d = DEFAULT_SETTINGS;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...d };
  const r = raw as Record<string, unknown>;
  return {
    uiScale: typeof r.uiScale === 'number' && UI_SCALES.includes(r.uiScale) ? r.uiScale : d.uiScale,
    quality: r.quality === 'low' || r.quality === 'high' ? r.quality : d.quality,
    bloom: typeof r.bloom === 'boolean' ? r.bloom : d.bloom,
    masterVolume: clamp01(r.masterVolume, d.masterVolume),
    musicVolume: clamp01(r.musicVolume, d.musicVolume),
    sfxVolume: clamp01(r.sfxVolume, d.sfxVolume),
  };
}

export function loadSettings(): Settings {
  try {
    const text = localStorage.getItem(SETTINGS_KEY);
    if (text) return parseSettings(JSON.parse(text));
    return parseSettings({ quality: localStorage.getItem(LEGACY_QUALITY_KEY) });
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

let current: Settings = loadSettings();
const listeners = new Set<() => void>();

export function getSettings(): Settings {
  return current;
}

export function updateSettings(patch: Partial<Settings>): void {
  current = parseSettings({ ...current, ...patch });
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(current));
  } catch {
    /* storage blocked; keep the in-memory value */
  }
  for (const l of listeners) l();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useSettings(): Settings {
  return useSyncExternalStore(subscribe, getSettings);
}
