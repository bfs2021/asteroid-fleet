import { describe, expect, it } from 'vitest';
import { apply } from './actions';
import { DOCK_RADIUS } from './config';
import { newGame } from './state';
import { step } from './tick';
import type { GameState, Ship } from './types';
import { leftBehind } from './warp';

/** A barge with a drone in its bay, both launched, plus a warp charging to system 1. */
function recallGame() {
  const s = newGame(21);
  s.credits = 10000;
  s.researchLevels.bargeBay = 1;
  expect(apply(s, { type: 'buyShip', cls: 'barge', hangarId: 2 })).toBeNull();
  expect(apply(s, { type: 'buyShip', cls: 'drone', hangarId: 2 })).toBeNull();
  const barge = s.ships.find((x) => x.cls === 'barge')!;
  const drone = s.ships.find((x) => x.cls === 'drone' && x.id > barge.id)!;
  barge.mode = 'idle';
  drone.mode = 'carried';
  drone.bargeId = barge.id;
  s.carrier.energy = 1000;
  expect(apply(s, { type: 'warp', systemId: 1 })).toBeNull();
  return { s, barge, drone };
}

const at = (s: GameState, ship: Ship, d: number) => {
  ship.pos = { x: s.carrier.pos.x + d, y: s.carrier.pos.y, z: s.carrier.pos.z };
};
const inHangar = (s: GameState, id: number) =>
  s.hangars.some((h) => h.items.some((it) => it.shipId === id));

describe('warp jump', () => {
  it('keeps a barge and its bay drones that reach the carrier just before the jump', () => {
    const { s, barge, drone } = recallGame();
    // On top of the carrier visually, but outside the 2-unit docking distance.
    at(s, barge, DOCK_RADIUS * 0.75);
    at(s, drone, DOCK_RADIUS * 0.75);
    for (const x of s.ships) if (x !== barge && x !== drone) x.mode = 'docked';
    expect(leftBehind(s)).toEqual([]);
    const lost = s.stats.shipsLost;
    apply(s, { type: 'jumpNow' });
    expect(s.systemId).toBe(1);
    expect(s.stats.shipsLost).toBe(lost);
    expect(barge.mode).toBe('docked');
    expect(drone.mode).toBe('docked');
    expect(inHangar(s, barge.id)).toBe(true);
    expect(inHangar(s, drone.id)).toBe(true);
    expect(s.log.some((l) => l.text.includes('outside at jump time'))).toBe(false);
  });

  it('keeps bay drones when the charge runs out on the tick their barge docks', () => {
    const { s, barge, drone } = recallGame();
    for (const x of s.ships) if (x !== barge && x !== drone) x.mode = 'docked';
    // The drone comes before the barge in s.ships, so it would only see the dock a tick later.
    s.ships = [drone, ...s.ships.filter((x) => x !== drone)];
    at(s, barge, DOCK_RADIUS * 0.5 + 0.01);
    at(s, drone, DOCK_RADIUS * 0.5 + 0.01);
    s.warp!.charge = 0.05;
    const lost = s.stats.shipsLost;
    step(s);
    expect(s.systemId).toBe(1);
    expect(s.stats.shipsLost).toBe(lost);
    expect(inHangar(s, drone.id)).toBe(true);
  });

  it('still loses ships clearly in transit, and the HUD count matches', () => {
    const { s, barge, drone } = recallGame();
    at(s, barge, 30);
    at(s, drone, 30);
    const expected = leftBehind(s).length;
    expect(expected).toBeGreaterThanOrEqual(2);
    const lost = s.stats.shipsLost;
    apply(s, { type: 'jumpNow' });
    expect(s.stats.shipsLost - lost).toBe(expected);
    expect(inHangar(s, barge.id)).toBe(false);
    expect(inHangar(s, drone.id)).toBe(false);
  });

  it('holds the carrier still while the warp charges', () => {
    const { s } = recallGame();
    s.carrier.target = { x: s.carrier.pos.x + 50, y: 0, z: s.carrier.pos.z };
    const before = { ...s.carrier.pos };
    for (let i = 0; i < 20; i++) step(s);
    expect(s.carrier.pos).toEqual(before);
  });
});
