import { useSyncExternalStore } from 'react';
import { apply, prestige, settleOffline, type Command, type OfflineReport } from '../sim/actions';
import { DT } from '../sim/config';
import { newGame } from '../sim/state';
import { step } from '../sim/tick';
import type { GameState, Vec3 } from '../sim/types';
import { loadGame, saveGame } from './save';

const TICK_MS = DT * 1000;
const MAX_CATCHUP_TICKS = 600; // a minute of sim; longer gaps go through offline settlement
const UI_HZ = 5;

/**
 * Owns the game state and runs the fixed-tick simulation outside React.
 * The renderer reads positions every frame and interpolates between the last two ticks;
 * the HTML UI re-renders a few times per second via `useGame`.
 */
class Engine {
  state: GameState = newGame();
  prev = new Map<number, Vec3>();
  prevCarrier: Vec3 = { x: 0, y: 0, z: 0 };
  lastTickAt = performance.now();
  speed = 1;
  paused = false;
  offline: OfflineReport | null = null;
  toast: { text: string; at: number } | null = null;
  loaded = false;

  private version = 0;
  private listeners = new Set<() => void>();
  private acc = 0;
  private lastFrame = performance.now();
  private lastUi = 0;
  private lastSave = performance.now();
  private timer: ReturnType<typeof setInterval> | null = null;

  async init() {
    const saved = await loadGame();
    if (saved) {
      this.state = saved;
      const report = settleOffline(this.state, (Date.now() - saved.savedAt) / 1000);
      if (report) this.offline = report;
    }
    this.loaded = true;
    this.snapshot();
    this.start();
    window.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.save();
    });
    window.addEventListener('beforeunload', () => this.save());
    this.emit();
  }

  start() {
    if (this.timer) return;
    this.lastFrame = performance.now();
    this.timer = setInterval(() => this.pump(), 25);
  }

  private snapshot() {
    this.prev.clear();
    for (const s of this.state.ships) this.prev.set(s.id, { ...s.pos });
    for (const p of this.state.pirates) this.prev.set(p.id, { ...p.pos });
    this.prevCarrier = { ...this.state.carrier.pos };
  }

  private pump() {
    const now = performance.now();
    const elapsed = now - this.lastFrame;
    this.lastFrame = now;
    if (!this.paused) this.acc += elapsed * this.speed;
    let ticks = 0;
    if (this.acc > MAX_CATCHUP_TICKS * TICK_MS) {
      // Long background-tab gap: settle it like offline time.
      const report = settleOffline(this.state, this.acc / 1000);
      if (report) this.offline = report;
      this.acc = 0;
    }
    while (this.acc >= TICK_MS && ticks < MAX_CATCHUP_TICKS) {
      this.snapshot();
      step(this.state);
      this.acc -= TICK_MS;
      ticks++;
      this.lastTickAt = now - this.acc / this.speed;
    }
    if (now - this.lastUi > 1000 / UI_HZ) {
      this.lastUi = now;
      this.emit();
    }
    if (now - this.lastSave > 15000) {
      this.lastSave = now;
      this.save();
    }
  }

  /** 0..1 progress between the previous and current tick, for interpolation. */
  alpha(): number {
    if (this.paused) return 1;
    const a = ((performance.now() - this.lastTickAt) * this.speed) / TICK_MS;
    return a < 0 ? 0 : a > 1 ? 1 : a;
  }

  dispatch(cmd: Command): boolean {
    const err = apply(this.state, cmd);
    if (err) this.toast = { text: err, at: Date.now() };
    this.emit();
    return !err;
  }

  doPrestige() {
    this.state = prestige(this.state);
    this.snapshot();
    this.save();
    this.emit();
  }

  replace(state: GameState) {
    this.state = state;
    this.snapshot();
    this.save();
    this.emit();
  }

  reset() {
    this.replace(newGame(Math.floor(Math.random() * 1e9)));
  }

  setSpeed(v: number) {
    this.speed = v;
    this.emit();
  }

  togglePause() {
    this.paused = !this.paused;
    this.emit();
  }

  dismissOffline() {
    this.offline = null;
    this.emit();
  }

  save() {
    this.state.savedAt = Date.now();
    void saveGame(this.state);
  }

  emit() {
    this.version++;
    for (const l of this.listeners) l();
  }

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  getVersion = () => this.version;
}

export const engine = new Engine();
// Handy for debugging and balancing from the browser console.
(globalThis as unknown as { __fleet: Engine }).__fleet = engine;

/** Re-render on UI ticks; read `engine.state` directly inside the component. */
export function useGame(): GameState {
  useSyncExternalStore(engine.subscribe, engine.getVersion);
  return engine.state;
}

export function lerpPos(id: number, cur: Vec3, a: number, out: Vec3): Vec3 {
  const p = engine.prev.get(id) ?? cur;
  out.x = p.x + (cur.x - p.x) * a;
  out.y = p.y + (cur.y - p.y) * a;
  out.z = p.z + (cur.z - p.z) * a;
  return out;
}
