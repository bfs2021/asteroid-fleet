// Warp jumps and the emergency jump when the carrier is disabled.

import { destroyShip } from './ctx';
import { copy } from './math';
import { enterSystem, log } from './state';
import type { GameState } from './types';

export function carrierDisabled(s: GameState) {
  log(s, 'Carrier hull critical! Emergency jump to the starter system.', 'bad');
  const lost = s.ships.filter((x) => x.mode !== 'docked');
  for (const l of lost) destroyShip(s, l, 'left behind in emergency jump');
  s.ships = s.ships.filter((x) => x.mode === 'docked');
  s.carrier.hull = s.carrier.maxHull * 0.5;
  s.carrier.shield = 0;
  s.carrier.ore = 0;
  s.carrier.oreValue = 0;
  s.warp = null;
  enterSystem(s, 0);
}

// ---------- warp ----------

export function warpStep(s: GameState, dt: number) {
  if (!s.warp) return;
  s.warp.charge -= dt;
  if (s.warp.charge > 0) return;
  executeJump(s);
}

export function executeJump(s: GameState) {
  if (!s.warp) return;
  const target = s.warp.targetSystem;
  const outside = s.ships.filter((x) => x.mode !== 'docked');
  for (const l of outside) destroyShip(s, l, 'outside at jump time');
  s.ships = s.ships.filter((x) => x.mode === 'docked');
  s.fx.push({ kind: 'warp', a: copy(s.carrier.pos), b: copy(s.carrier.pos), ttl: 1.5 });
  s.warp = null;
  enterSystem(s, target);
  for (const sh of s.ships) sh.pos = copy(s.carrier.pos);
  log(s, `Warped to ${s.systems[target].name}.`, 'good');
}
