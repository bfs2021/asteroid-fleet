import {
  CARRIER_SENSOR,
  COVER_RADIUS,
  DOCK_RADIUS,
  DT,
  FUSION_H2,
  FUSION_RATE,
  HANGAR_TYPES,
  MINING_RATE,
  PIRATE_BASE,
  REFINE_ENERGY,
  refineRate,
  SHIP_STATS,
  SOLAR_RATE,
  WAVE_INTERVAL,
  WAVE_WARNING,
  warpCost,
} from './config';
import { effectiveStance, rule } from './doctrine';
import { carrierStorage, dockRepairRate, hangarOf } from './hangar';
import { copy, dist, dist2, moveAway, moveToward, onSphere, rand, randRange, seeded } from './math';
import { lvl } from './research';
import {
  clusterCenters,
  createShip,
  enterSystem,
  gasGiantPos,
  log,
  maxEnergy,
  maxHull,
  spawnAsteroid,
} from './state';
import type { Asteroid, GameState, Pirate, Ship, ShipClass, Vec3 } from './types';

export const SHIELD_HP = 600;
const CARRIER = -2;

interface Ctx {
  ships: Map<number, Ship>;
  pirates: Map<number, Pirate>;
  asteroids: Map<number, Asteroid>;
  miners: Map<number, number>; // asteroid id -> drones assigned
  escorts: Map<number, number>; // ship id -> fighters escorting
  haulerClaims: Set<number>; // barge ids a hauler is heading to
  recall: boolean;
  income: number;
  mining: number;
}

// ---------- stat helpers ----------

export function cargoCap(s: GameState, cls: ShipClass): number {
  const base = SHIP_STATS[cls].cargo;
  if (cls === 'barge') return base * (1 + 0.2 * lvl(s, 'bargeCap'));
  if (cls === 'drone') return base * (1 + 0.2 * lvl(s, 'droneCargo'));
  return base;
}

function speed(s: GameState, ship: Ship): number {
  let v = SHIP_STATS[ship.cls].speed;
  if (ship.cls === 'hauler') v *= 1 + 0.12 * lvl(s, 'haulSpeed');
  return v;
}

function fighterDamage(s: GameState, ship: Ship): number {
  let d = SHIP_STATS.fighter.damage * (1 + 0.15 * lvl(s, 'damage'));
  if (lvl(s, 'fighterAce') > 0) {
    const h = hangarOf(s, ship.id);
    if (h && h.items.every((it) => s.ships.find((x) => x.id === it.shipId)?.cls === 'fighter'))
      d *= 1.25;
  }
  return d;
}

function miningRate(s: GameState, ship: Ship): number {
  let r = MINING_RATE * (1 + 0.15 * lvl(s, 'yield'));
  if (lvl(s, 'droneSwarm') > 0) {
    const h = hangarOf(s, ship.id);
    const n = h
      ? h.items.filter((it) => s.ships.find((x) => x.id === it.shipId)?.cls === 'drone').length
      : 0;
    r *= 1 + Math.min(0.5, 0.1 * n);
  }
  return r;
}

export function cargoHeat(s: GameState): number {
  let v = s.carrier.oreValue;
  for (const sh of s.ships) if (sh.mode !== 'docked') v += sh.cargoValue;
  return v;
}

export function heatFactor(s: GameState): number {
  const tier = s.systems[s.systemId].tier;
  return 1 + Math.min(2, cargoHeat(s) / (2500 * tier));
}

export function waveWarning(s: GameState): number {
  const scouts = s.ships.filter((x) => x.cls === 'scout' && x.mode !== 'docked').length;
  return WAVE_WARNING + (lvl(s, 'scoutRelay') > 0 ? 10 * scouts : 0);
}

function inHazard(s: GameState, p: Vec3): boolean {
  return s.hazards.some((h) => dist2(h.pos, p) < h.radius * h.radius);
}

function covered(s: GameState, p: Vec3, ctx: Ctx): boolean {
  if (dist(p, s.carrier.pos) < COVER_RADIUS) return true;
  for (const sh of ctx.ships.values()) {
    if (sh.cls === 'barge' && sh.mode === 'station' && dist(p, sh.pos) < COVER_RADIUS * 0.6)
      return true;
    if (sh.cls === 'fighter' && sh.mode !== 'docked' && dist(p, sh.pos) < COVER_RADIUS * 0.5)
      return true;
  }
  return false;
}

function nearestPirate(s: GameState, p: Vec3, within: number): Pirate | null {
  let best: Pirate | null = null;
  let bd = within * within;
  for (const pi of s.pirates) {
    const d = dist2(pi.pos, p);
    if (d < bd) {
      bd = d;
      best = pi;
    }
  }
  return best;
}

// ---------- damage ----------

export function damageShip(s: GameState, ship: Ship, dmg: number) {
  if (ship.cls === 'hauler' && lvl(s, 'haulerArmor') > 0) dmg *= 0.6;
  ship.hull -= dmg;
}

function damageCarrier(s: GameState, dmg: number) {
  const c = s.carrier;
  if (c.shield > 0) {
    const absorbed = Math.min(dmg, c.shield * SHIELD_HP);
    c.shield -= absorbed / SHIELD_HP;
    dmg -= absorbed;
  }
  c.hull -= dmg;
}

function destroyShip(s: GameState, ship: Ship, why: string) {
  s.fx.push({ kind: 'explosion', a: copy(ship.pos), b: copy(ship.pos), ttl: 0.8 });
  for (const h of s.hangars) h.items = h.items.filter((it) => it.shipId !== ship.id);
  s.stats.shipsLost++;
  log(s, `${SHIP_STATS[ship.cls].name} lost (${why}).`, 'bad');
}

// ---------- main step ----------

export function step(s: GameState, dt = DT) {
  s.time += dt;
  const ctx: Ctx = {
    ships: new Map(s.ships.map((x) => [x.id, x])),
    pirates: new Map(s.pirates.map((x) => [x.id, x])),
    asteroids: new Map(s.asteroids.map((x) => [x.id, x])),
    miners: new Map(),
    escorts: new Map(),
    haulerClaims: new Set(),
    recall: false,
    income: 0,
    mining: 0,
  };
  for (const sh of s.ships) {
    if (
      sh.cls === 'drone' &&
      sh.targetId >= 0 &&
      (sh.mode === 'toAsteroid' || sh.mode === 'mining')
    )
      ctx.miners.set(sh.targetId, (ctx.miners.get(sh.targetId) ?? 0) + 1);
    if (sh.cls === 'fighter' && sh.escortId >= 0)
      ctx.escorts.set(sh.escortId, (ctx.escorts.get(sh.escortId) ?? 0) + 1);
    if (sh.cls === 'hauler' && sh.mode === 'toBarge') ctx.haulerClaims.add(sh.targetId);
  }
  const lowShields = rule(s, 'recallOnLowShields');
  ctx.recall =
    !!s.warp || (!!lowShields && s.carrier.shield < lowShields.param && s.pirates.length > 0);

  for (const f of s.fx) f.ttl -= dt;
  s.fx = s.fx.filter((f) => f.ttl > 0);

  power(s, dt);
  threats(s, dt);
  launch(s, dt, ctx);
  for (const ship of s.ships) {
    if (ship.mode === 'docked') {
      ship.pos.x = s.carrier.pos.x;
      ship.pos.y = s.carrier.pos.y;
      ship.pos.z = s.carrier.pos.z;
      const mh = maxHull(s, ship.cls);
      ship.hull = Math.min(mh, ship.hull + dockRepairRate(s, ship.id) * mh * dt);
      continue;
    }
    behave(s, ship, dt, ctx);
  }
  pirateStep(s, dt, ctx);
  hazards(s, dt);
  refine(s, dt, ctx);
  field(s, dt);
  reserves(s, dt);
  drift(s, dt);

  // cleanup
  const dead = s.ships.filter((x) => x.hull <= 0);
  for (const d of dead) destroyShip(s, d, 'destroyed');
  if (dead.length) s.ships = s.ships.filter((x) => x.hull > 0);
  const deadP = s.pirates.filter((p) => p.hull <= 0);
  for (const p of deadP) {
    const tier = s.systems[s.systemId].tier;
    const salvage = Math.round(12 * tier * (p.maxHull / PIRATE_BASE.hull));
    s.credits += salvage;
    ctx.income += salvage;
    s.stats.piratesKilled++;
    s.fx.push({ kind: 'explosion', a: copy(p.pos), b: copy(p.pos), ttl: 0.8 });
  }
  if (deadP.length) s.pirates = s.pirates.filter((p) => p.hull > 0);
  if (s.wave.active && s.pirates.length === 0) {
    s.wave.active = false;
    log(s, 'Pirate wave repelled.', 'good');
  }
  if (s.carrier.hull <= 0) carrierDisabled(s);

  s.stats.creditsEarned += ctx.income;
  const a = Math.min(1, dt / 120);
  s.incomeAvg = s.incomeAvg * (1 - a) + (ctx.income / dt) * a;
  s.miningIncomeAvg = s.miningIncomeAvg * (1 - a) + (ctx.mining / dt) * a;
  warpStep(s, dt);
}

// ---------- power ----------

function power(s: GameState, dt: number) {
  const c = s.carrier;
  const sys = s.systems[s.systemId];
  const max = maxEnergy(s);
  let gain =
    SOLAR_RATE * sys.brightness * (1 + 0.2 * lvl(s, 'solar')) * (s.storm.active > 0 ? 1.6 : 1);
  if (lvl(s, 'fusion') > 0 && c.h2 > 0 && c.energy < max) {
    const burn = Math.min(c.h2, FUSION_H2 * dt);
    c.h2 -= burn;
    gain += FUSION_RATE * (burn / (FUSION_H2 * dt));
  }
  c.energy = Math.min(max, c.energy + gain * dt);
  // Shield regen costs energy; when the pool is empty the shields stay down.
  if (c.shield < 1 && c.energy > 0) {
    const mult = s.powerMode === 'defense' ? 2 : s.powerMode === 'income' ? 0.5 : 1;
    const regen = Math.min(1 - c.shield, 0.03 * mult * dt);
    const cost = regen * SHIELD_HP * 0.4;
    if (c.energy >= cost) {
      c.energy -= cost;
      c.shield += regen;
    }
  }
}

function refine(s: GameState, dt: number, ctx: Ctx) {
  const c = s.carrier;
  if (c.ore <= 0) return;
  const max = maxEnergy(s);
  let floor = s.powerMode === 'defense' ? 0.5 * max : s.powerMode === 'balanced' ? 0.15 * max : 0;
  if (rule(s, 'reserveWarpEnergy')) {
    const sys = s.systems[s.systemId];
    floor = Math.max(floor, warpCost(sys.distance, Math.max(0, sys.distance - 1)));
  }
  const avail = Math.max(0, c.energy - floor);
  const amount = Math.min(c.ore, refineRate(c.refinery) * dt, avail / REFINE_ENERGY);
  if (amount <= 0) return;
  const value = (c.oreValue / c.ore) * amount;
  c.ore -= amount;
  c.oreValue -= value;
  if (c.ore < 1e-6) {
    c.ore = 0;
    c.oreValue = 0;
  }
  c.energy -= amount * REFINE_ENERGY;
  s.credits += value;
  ctx.income += value;
  ctx.mining += value;
}

/** Unload cargo at the carrier, capped by storage. Returns true when the hold is empty. */
function unloadAtCarrier(s: GameState, ship: Ship): boolean {
  const c = s.carrier;
  if (ship.h2 > 0) {
    c.h2 += ship.h2;
    ship.h2 = 0;
  }
  if (ship.cargo <= 0) return true;
  const space = carrierStorage(s) - c.ore;
  const amt = Math.min(space, ship.cargo);
  if (amt <= 0) return false;
  const val = (ship.cargoValue / ship.cargo) * amt;
  c.ore += amt;
  c.oreValue += val;
  s.stats.oreValueDelivered += val;
  ship.cargo -= amt;
  ship.cargoValue -= val;
  if (ship.cargo < 1e-6) {
    ship.cargo = 0;
    ship.cargoValue = 0;
  }
  return ship.cargo === 0;
}

function transfer(from: Ship, to: Ship, cap: number) {
  if (from.cargo <= 0) return;
  const amt = Math.min(from.cargo, cap - to.cargo);
  if (amt <= 0) return;
  const val = (from.cargoValue / from.cargo) * amt;
  to.cargo += amt;
  to.cargoValue += val;
  from.cargo -= amt;
  from.cargoValue -= val;
  if (from.cargo < 1e-6) {
    from.cargo = 0;
    from.cargoValue = 0;
  }
}

function dock(s: GameState, ship: Ship) {
  unloadAtCarrier(s, ship);
  ship.mode = 'docked';
  ship.targetId = -1;
  ship.escortId = -1;
  ship.station = null;
}

// ---------- launching ----------

function wantsLaunch(s: GameState, ship: Ship, ctx: Ctx): boolean {
  if (ctx.recall) return false;
  const mh = maxHull(s, ship.cls);
  if (ship.hull < mh * 0.9) return false;
  const sys = s.systems[s.systemId];
  switch (ship.cls) {
    case 'barge':
      // Barges launch only once the zone is secured.
      return s.pirates.length === 0;
    case 'hauler':
      return !rule(s, 'haulerPark') || haulerJob(s, ship, ctx) !== null;
    case 'harvester':
      return sys.gasGiant && lvl(s, 'fusion') > 0 && s.pirates.length === 0;
    case 'repair':
      return s.ships.some((x) => x.mode !== 'docked' && x.hull < maxHull(s, x.cls) * 0.85);
    default:
      return true;
  }
}

function launch(s: GameState, dt: number, ctx: Ctx) {
  for (const h of s.hangars) {
    h.launchTimer -= dt;
    if (h.launchTimer > 0) continue;
    const docked = h.items
      .map((it) => ctx.ships.get(it.shipId))
      .filter((x): x is Ship => !!x && x.mode === 'docked');
    if (!docked.length) continue;
    const rank = (c: ShipClass) => {
      const i = h.launchOrder.indexOf(c);
      return i < 0 ? 99 : i;
    };
    docked.sort((a, b) => rank(a.cls) - rank(b.cls));
    const next = docked.find((x) => wantsLaunch(s, x, ctx));
    if (!next) continue;
    next.mode = 'idle';
    const off = onSphere(() => rand(s), 3, 0.5);
    next.pos = {
      x: s.carrier.pos.x + off.x,
      y: s.carrier.pos.y + off.y,
      z: s.carrier.pos.z + off.z,
    };
    h.launchTimer = HANGAR_TYPES[h.type].launchInterval;
  }
}

// ---------- ship behaviour ----------

function goHome(s: GameState, ship: Ship, dt: number): boolean {
  if (moveToward(ship.pos, s.carrier.pos, speed(s, ship) * dt, DOCK_RADIUS * 0.5)) {
    dock(s, ship);
    return true;
  }
  return false;
}

function behave(s: GameState, ship: Ship, dt: number, ctx: Ctx) {
  const st = effectiveStance(s, ship);
  const mh = maxHull(s, ship.cls);

  if (ctx.recall) ship.mode = 'recall';
  if (ship.mode === 'recall' || ship.mode === 'retreat') {
    if (!ctx.recall && ship.mode === 'recall') ship.mode = 'idle';
    else {
      goHome(s, ship, dt);
      return;
    }
  }
  // Under-fire stances.
  if (st.underFire === 'retreatHull' && ship.hull < mh * st.retreatAt) {
    ship.mode = 'retreat';
    log(s, `${SHIP_STATS[ship.cls].name} retreating for repairs.`, 'warn');
    return;
  }
  const threat = nearestPirate(s, ship.pos, ship.cls === 'fighter' ? 0 : 18);
  if (threat && st.underFire === 'retreatCargo' && ship.cargo > 0 && ship.cls !== 'barge') {
    ship.mode = 'toCarrier';
  }
  if (threat && st.engagement === 'passive' && ship.cls !== 'fighter') {
    moveAway(ship.pos, threat.pos, speed(s, ship) * dt);
    return;
  }

  switch (ship.cls) {
    case 'drone':
      return drone(s, ship, dt, ctx, st.mining);
    case 'barge':
      return barge(s, ship, dt, ctx, st.mining);
    case 'hauler':
      return hauler(s, ship, dt, ctx);
    case 'fighter':
      return fighter(s, ship, dt, ctx, st.engagement);
    case 'scout':
      return scout(s, ship, dt);
    case 'repair':
      return repairDrone(s, ship, dt, ctx);
    case 'harvester':
      return harvester(s, ship, dt);
  }
}

function pickAsteroid(
  s: GameState,
  ship: Ship,
  ctx: Ctx,
  mining: 'greedy' | 'safe',
): Asteroid | null {
  let best: Asteroid | null = null;
  let bestScore = -Infinity;
  for (const a of s.asteroids) {
    if (a.ore <= 0) continue;
    const crowd = ctx.miners.get(a.id) ?? 0;
    if (crowd >= 3) continue;
    const d = dist(ship.pos, a.pos);
    let score: number;
    if (mining === 'safe') {
      if (inHazard(s, a.pos) || !covered(s, a.pos, ctx)) continue;
      score = a.value / (d + 8) - crowd * 0.05;
    } else {
      score = (a.value * a.value) / (d + 25) - crowd * 0.2;
    }
    if (score > bestScore) {
      bestScore = score;
      best = a;
    }
  }
  return best;
}

function bestDropoff(s: GameState, ship: Ship, ctx: Ctx): Ship | null {
  const r = rule(s, 'droneUnloadAtBarge');
  if (!r) return null;
  if (dist(ship.pos, s.carrier.pos) <= r.param) return null;
  let best: Ship | null = null;
  let bd = dist(ship.pos, s.carrier.pos);
  for (const b of ctx.ships.values()) {
    if (b.cls !== 'barge' || b.mode !== 'station') continue;
    if (b.cargo >= cargoCap(s, 'barge') - 1) continue;
    const d = dist(ship.pos, b.pos);
    if (d < bd) {
      bd = d;
      best = b;
    }
  }
  return best;
}

function drone(s: GameState, ship: Ship, dt: number, ctx: Ctx, mining: 'greedy' | 'safe') {
  const cap = cargoCap(s, 'drone');
  const v = speed(s, ship) * dt;
  if (ship.mode === 'toCarrier' || ship.mode === 'toDropoff' || ship.cargo >= cap - 1e-6) {
    if (ship.mode !== 'toDropoff' && ship.mode !== 'toCarrier') {
      const b = bestDropoff(s, ship, ctx);
      ship.mode = b ? 'toDropoff' : 'toCarrier';
      ship.targetId = b ? b.id : CARRIER;
    }
    if (ship.mode === 'toDropoff') {
      const b = ctx.ships.get(ship.targetId);
      if (!b || b.mode !== 'station' || b.cargo >= cargoCap(s, 'barge') - 1) {
        ship.mode = 'toCarrier';
        ship.targetId = CARRIER;
        return;
      }
      if (moveToward(ship.pos, b.pos, v, 2.5)) {
        transfer(ship, b, cargoCap(s, 'barge'));
        if (ship.cargo === 0) ship.mode = 'idle';
      }
      return;
    }
    if (moveToward(ship.pos, s.carrier.pos, v, DOCK_RADIUS * 0.6)) {
      if (unloadAtCarrier(s, ship)) ship.mode = 'idle';
    }
    return;
  }
  let a = ctx.asteroids.get(ship.targetId);
  if (ship.mode === 'idle' || !a || a.ore <= 0) {
    a = pickAsteroid(s, ship, ctx, mining) ?? undefined;
    if (!a) {
      if (ship.cargo > 0) ship.mode = 'toCarrier';
      else goHome(s, ship, dt);
      return;
    }
    ship.targetId = a.id;
    ship.mode = 'toAsteroid';
    ctx.miners.set(a.id, (ctx.miners.get(a.id) ?? 0) + 1);
  }
  if (ship.mode === 'toAsteroid') {
    if (moveToward(ship.pos, a.pos, v, a.radius + 1)) ship.mode = 'mining';
    return;
  }
  if (ship.mode === 'mining') {
    const amt = Math.min(a.ore, miningRate(s, ship) * dt, cap - ship.cargo);
    a.ore -= amt;
    ship.cargo += amt;
    ship.cargoValue += amt * a.value;
    if (a.ore <= 0) {
      a.ore = 0;
      a.respawn = 40 + rand(s) * 40;
      ship.mode = 'idle';
    }
    return;
  }
  ship.mode = 'idle';
}

function oreNear(s: GameState, p: Vec3, r: number): number {
  let v = 0;
  const r2 = r * r;
  for (const a of s.asteroids) if (dist2(a.pos, p) < r2) v += a.ore * a.value;
  return v;
}

function barge(s: GameState, ship: Ship, dt: number, ctx: Ctx, mining: 'greedy' | 'safe') {
  const cap = cargoCap(s, 'barge');
  const v = speed(s, ship) * dt;
  if (rule(s, 'bargeFallBack') && nearestPirate(s, ship.pos, 28)) {
    ship.mode = 'retreat';
    log(s, 'Barge falling back to the carrier.', 'warn');
    return;
  }
  const haulersExist = s.ships.some((x) => x.cls === 'hauler');
  if (ship.mode === 'toCarrier' || (ship.cargo >= cap * 0.98 && !haulersExist)) {
    ship.mode = 'toCarrier';
    if (moveToward(ship.pos, s.carrier.pos, v, DOCK_RADIUS)) {
      unloadAtCarrier(s, ship);
      ship.mode = 'idle';
    }
    return;
  }
  // Re-pick the station when it is unset or the local field has run dry.
  if (
    !ship.station ||
    (ship.mode === 'station' &&
      Math.floor(s.time * 10) % 50 === ship.id % 50 &&
      oreNear(s, ship.station, 14) < 200)
  ) {
    ship.station = pickStation(s, ship, ctx, mining);
    ship.mode = 'idle';
  }
  if (!ship.station) {
    if (ship.cargo > 0) ship.mode = 'toCarrier';
    else goHome(s, ship, dt);
    return;
  }
  if (ship.mode !== 'station') {
    if (moveToward(ship.pos, ship.station, v, 0.5)) ship.mode = 'station';
  }
}

function pickStation(s: GameState, ship: Ship, ctx: Ctx, mining: 'greedy' | 'safe'): Vec3 | null {
  let best: Vec3 | null = null;
  let bs = -Infinity;
  const others = s.ships.filter((x) => x.cls === 'barge' && x.id !== ship.id && x.station);
  const sys = s.systems[s.systemId];
  for (const c of clusterCenters(sys)) {
    const d = dist(c, s.carrier.pos);
    if (mining === 'safe' && d > 55) continue;
    if (inHazard(s, c)) continue;
    if (others.some((o) => dist(o.station!, c) < 12)) continue;
    const value = oreNear(s, c, 14);
    if (value < 100) continue;
    const score = (mining === 'greedy' ? value : value / (d + 20)) * (covered(s, c, ctx) ? 1.2 : 1);
    if (score > bs) {
      bs = score;
      best = { x: c.x * 0.85, y: c.y, z: c.z * 0.85 };
    }
  }
  return best;
}

function haulerJob(s: GameState, ship: Ship, ctx: Ctx): Ship | null {
  const r = rule(s, 'bargeCallHauler');
  const threshold = r ? r.param : 0.98;
  const cap = cargoCap(s, 'barge');
  let best: Ship | null = null;
  let bf = 0;
  for (const b of ctx.ships.values()) {
    if (b.cls !== 'barge' || b.mode !== 'station') continue;
    if (ctx.haulerClaims.has(b.id) && ship.targetId !== b.id) continue;
    const fill = b.cargo / cap;
    if (fill >= threshold && fill > bf) {
      bf = fill;
      best = b;
    }
  }
  return best;
}

function hauler(s: GameState, ship: Ship, dt: number, ctx: Ctx) {
  const cap = cargoCap(s, 'hauler');
  const v = speed(s, ship) * dt;
  if (ship.mode === 'toCarrier') {
    if (moveToward(ship.pos, s.carrier.pos, v, DOCK_RADIUS)) {
      if (unloadAtCarrier(s, ship)) ship.mode = 'idle';
    }
    return;
  }
  if (ship.mode === 'toBarge') {
    const b = ctx.ships.get(ship.targetId);
    if (!b || b.mode !== 'station') {
      ship.mode = ship.cargo > 0 ? 'toCarrier' : 'idle';
      return;
    }
    if (moveToward(ship.pos, b.pos, v, 2.5)) {
      transfer(b, ship, cap);
      ship.mode = 'toCarrier';
    }
    return;
  }
  const job = haulerJob(s, ship, ctx);
  if (job) {
    ship.mode = 'toBarge';
    ship.targetId = job.id;
    ctx.haulerClaims.add(job.id);
    return;
  }
  if (ship.cargo > 0) {
    ship.mode = 'toCarrier';
    return;
  }
  if (rule(s, 'haulerPark')) goHome(s, ship, dt);
  else moveToward(ship.pos, s.carrier.pos, v, 8);
}

function fighterTarget(s: GameState, ship: Ship, ctx: Ctx, engagement: string): Pirate | null {
  const sensor = SHIP_STATS.fighter.sensor;
  if (engagement === 'passive') return null;
  if (engagement === 'aggressive')
    return nearestPirate(s, ship.pos, sensor) ?? nearestPirate(s, s.carrier.pos, sensor * 1.5);
  if (engagement === 'escort') {
    const ward = ctx.ships.get(ship.escortId);
    const anchor = ward ? ward.pos : s.carrier.pos;
    let best: Pirate | null = null;
    let bd = Infinity;
    for (const p of s.pirates) {
      const d = dist(p.pos, anchor);
      if ((p.targetId === ship.escortId && d < 40) || d < 18) {
        if (d < bd) {
          bd = d;
          best = p;
        }
      }
    }
    return best;
  }
  // defensive: hostiles attacking own ships, or close to the carrier
  let best: Pirate | null = null;
  let bd = Infinity;
  for (const p of s.pirates) {
    const victim = p.targetId === CARRIER ? s.carrier.pos : ctx.ships.get(p.targetId)?.pos;
    const engaged = victim && dist(p.pos, victim) < 20;
    const nearCarrier = dist(p.pos, s.carrier.pos) < CARRIER_SENSOR;
    if (!engaged && !nearCarrier) continue;
    const d = dist(p.pos, ship.pos);
    if (d < bd) {
      bd = d;
      best = p;
    }
  }
  return best;
}

function pickWard(ctx: Ctx): number {
  let best = -1;
  let bs = -Infinity;
  for (const w of ctx.ships.values()) {
    if (w.mode === 'docked') continue;
    if (w.cls !== 'barge' && w.cls !== 'hauler' && w.cls !== 'harvester') continue;
    const n = ctx.escorts.get(w.id) ?? 0;
    const score = (w.cls === 'barge' ? 3 : 1) + w.cargo / 200 - n * 2.5;
    if (score > bs) {
      bs = score;
      best = w.id;
    }
  }
  return best;
}

function orbit(p: Vec3, c: Vec3, r: number, t: number, phase: number, step: number) {
  const a = t * 0.35 + phase;
  moveToward(
    p,
    { x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a * 0.7) * 2, z: c.z + Math.sin(a) * r },
    step,
  );
}

function fighter(s: GameState, ship: Ship, dt: number, ctx: Ctx, engagement: string) {
  const v = speed(s, ship) * dt;
  if (engagement === 'escort') {
    const ward = ctx.ships.get(ship.escortId);
    if (!ward || ward.mode === 'docked') {
      const prev = ship.escortId;
      if (prev >= 0) ctx.escorts.set(prev, Math.max(0, (ctx.escorts.get(prev) ?? 1) - 1));
      ship.escortId = pickWard(ctx);
      if (ship.escortId >= 0)
        ctx.escorts.set(ship.escortId, (ctx.escorts.get(ship.escortId) ?? 0) + 1);
    }
  } else ship.escortId = -1;

  const target = fighterTarget(s, ship, ctx, engagement);
  ship.fireCooldown -= dt;
  if (target) {
    ship.mode = 'attack';
    ship.targetId = target.id;
    const range = SHIP_STATS.fighter.range;
    moveToward(ship.pos, target.pos, v, range * 0.7);
    if (dist(ship.pos, target.pos) <= range) {
      target.hull -= fighterDamage(s, ship) * dt;
      if (ship.fireCooldown <= 0) {
        s.fx.push({ kind: 'laser', a: copy(ship.pos), b: copy(target.pos), ttl: 0.15 });
        ship.fireCooldown = 0.35;
      }
    }
    return;
  }
  ship.targetId = -1;
  const ward = ctx.ships.get(ship.escortId);
  if (engagement === 'escort' && ward) {
    ship.mode = 'escort';
    orbit(ship.pos, ward.pos, 5, s.time, ship.id, v);
  } else if (engagement === 'aggressive') {
    ship.mode = 'patrol';
    orbit(ship.pos, s.carrier.pos, 32, s.time * 0.5, ship.id, v);
  } else {
    ship.mode = 'patrol';
    orbit(ship.pos, s.carrier.pos, 12, s.time, ship.id, v);
  }
}

function scout(s: GameState, ship: Ship, dt: number) {
  ship.mode = 'patrol';
  orbit(ship.pos, s.carrier.pos, 75, s.time * 0.15, ship.id * 1.7, speed(s, ship) * dt);
}

function repairDrone(s: GameState, ship: Ship, dt: number, ctx: Ctx) {
  const v = speed(s, ship) * dt;
  let patient = ctx.ships.get(ship.targetId);
  if (!patient || patient.mode === 'docked' || patient.hull >= maxHull(s, patient.cls) * 0.98) {
    patient = undefined;
    let worst = 0.85;
    for (const o of ctx.ships.values()) {
      if (o.id === ship.id || o.mode === 'docked') continue;
      let frac = o.hull / maxHull(s, o.cls);
      if (o.cls === 'barge' || o.cls === 'fighter') frac -= 0.1;
      if (frac < worst) {
        worst = frac;
        patient = o;
      }
    }
    ship.targetId = patient ? patient.id : -1;
  }
  if (!patient) {
    goHome(s, ship, dt);
    return;
  }
  ship.mode = 'repairing';
  const range = SHIP_STATS.repair.range;
  moveToward(ship.pos, patient.pos, v, range * 0.6);
  const heal = 7 * (1 + 0.3 * lvl(s, 'repair')) * dt;
  const nano = lvl(s, 'repairNano') > 0;
  for (const o of ctx.ships.values()) {
    if (o.mode === 'docked' || (o !== patient && !nano)) continue;
    if (dist(o.pos, ship.pos) > range) continue;
    o.hull = Math.min(maxHull(s, o.cls), o.hull + heal);
  }
  ship.fireCooldown -= dt;
  if (ship.fireCooldown <= 0 && dist(patient.pos, ship.pos) <= range) {
    s.fx.push({ kind: 'repair', a: copy(ship.pos), b: copy(patient.pos), ttl: 0.3 });
    ship.fireCooldown = 0.5;
  }
}

function harvester(s: GameState, ship: Ship, dt: number) {
  const sys = s.systems[s.systemId];
  const v = speed(s, ship) * dt;
  if (!sys.gasGiant) {
    goHome(s, ship, dt);
    return;
  }
  const cap = cargoCap(s, 'harvester');
  if (ship.h2 >= cap || ship.mode === 'toCarrier') {
    ship.mode = 'toCarrier';
    if (moveToward(ship.pos, s.carrier.pos, v, DOCK_RADIUS)) {
      unloadAtCarrier(s, ship);
      ship.mode = 'idle';
    }
    return;
  }
  const g = gasGiantPos(sys);
  if (moveToward(ship.pos, g, v, 30)) {
    ship.mode = 'station';
    ship.h2 = Math.min(cap, ship.h2 + 1.2 * dt);
  } else ship.mode = 'toAsteroid';
}

// ---------- pirates & hazards ----------

function threats(s: GameState, dt: number) {
  const sys = s.systems[s.systemId];
  if (sys.tier === 1) return;
  const w = s.wave;
  w.timer -= dt;
  const warn = waveWarning(s);
  if (!w.warning && w.timer <= warn) {
    w.warning = true;
    w.size = Math.max(1, Math.round((1 + sys.distance * 0.7 + (sys.tier - 2) * 2) * heatFactor(s)));
    log(s, `Pirate wave inbound: ${w.size} raiders in ${Math.ceil(w.timer)} s.`, 'warn');
  }
  if (w.timer <= 0) {
    w.warning = false;
    w.active = true;
    const r = seeded(s.rng ^ 0x77);
    const a = r() * Math.PI * 2;
    const scale = 1 + sys.distance * 0.25;
    for (let i = 0; i < w.size; i++) {
      const pos = {
        x: s.carrier.pos.x + Math.cos(a) * 110 + randRange(s, -10, 10),
        y: randRange(s, -6, 6),
        z: s.carrier.pos.z + Math.sin(a) * 110 + randRange(s, -10, 10),
      };
      s.pirates.push({
        id: s.nextId++,
        pos,
        hull: PIRATE_BASE.hull * scale,
        maxHull: PIRATE_BASE.hull * scale,
        damage: PIRATE_BASE.damage * (1 + sys.distance * 0.15),
        speed: PIRATE_BASE.speed,
        targetId: -1,
        fireCooldown: 0,
      });
    }
    log(s, 'Pirates have arrived!', 'bad');
    w.timer = WAVE_INTERVAL(sys.tier) * randRange(s, 0.8, 1.2);
  }
  // Solar storms in the frontier and beyond.
  const st = s.storm;
  if (st.active > 0) {
    st.active -= dt;
    if (st.active <= 0) log(s, 'Solar storm passed.', 'info');
  } else {
    st.timer -= dt;
    if (st.timer <= 0) {
      st.active = 20;
      st.timer = randRange(s, 120, 220);
      log(s, 'Solar storm: ships outside take damage, solar output up.', 'warn');
    }
  }
}

function pirateTargetScore(s: GameState, sh: Ship): number {
  if (sh.mode === 'docked') return 0;
  if (sh.cls === 'barge') return 4 + (sh.cargo / cargoCap(s, 'barge')) * 6; // full barges first
  if (sh.cls === 'hauler' || sh.cls === 'harvester') return 2 + sh.cargo / 60;
  if (sh.cls === 'fighter') return 1.5;
  return 1;
}

function pirateStep(s: GameState, dt: number, ctx: Ctx) {
  for (const p of s.pirates) {
    let tgtPos: Vec3 | null =
      p.targetId === CARRIER ? s.carrier.pos : (ctx.ships.get(p.targetId)?.pos ?? null);
    const t = ctx.ships.get(p.targetId);
    if (!tgtPos || (t && t.mode === 'docked') || rand(s) < dt / 3) {
      let best = CARRIER;
      let bs = 0.6 / (dist(p.pos, s.carrier.pos) + 30);
      for (const sh of ctx.ships.values()) {
        const sc = pirateTargetScore(s, sh);
        if (sc <= 0) continue;
        const v = sc / (dist(p.pos, sh.pos) + 30);
        if (v > bs) {
          bs = v;
          best = sh.id;
        }
      }
      p.targetId = best;
      tgtPos = best === CARRIER ? s.carrier.pos : ctx.ships.get(best)!.pos;
    }
    const range = p.targetId === CARRIER ? 12 : 7;
    moveToward(p.pos, tgtPos, p.speed * dt, range * 0.8);
    p.fireCooldown -= dt;
    if (dist(p.pos, tgtPos) <= range) {
      const dmg = p.damage * dt;
      if (p.targetId === CARRIER) damageCarrier(s, dmg);
      else {
        const victim = ctx.ships.get(p.targetId);
        if (victim) damageShip(s, victim, dmg);
      }
      if (p.fireCooldown <= 0) {
        s.fx.push({ kind: 'pirateLaser', a: copy(p.pos), b: copy(tgtPos), ttl: 0.15 });
        p.fireCooldown = 0.5;
      }
    }
  }
}

function hazards(s: GameState, dt: number) {
  for (const sh of s.ships) {
    if (sh.mode === 'docked') continue;
    for (const h of s.hazards)
      if (dist2(h.pos, sh.pos) < h.radius * h.radius) damageShip(s, sh, h.dps * dt);
    if (s.storm.active > 0 && dist(sh.pos, s.carrier.pos) > COVER_RADIUS)
      damageShip(s, sh, 0.6 * dt);
  }
}

// ---------- field, reserves, carrier ----------

function field(s: GameState, dt: number) {
  const sys = s.systems[s.systemId];
  const scouts = s.ships.filter((x) => x.cls === 'scout' && x.mode !== 'docked').length;
  const centers = clusterCenters(sys);
  for (let i = 0; i < s.asteroids.length; i++) {
    const a = s.asteroids[i];
    if (a.ore > 0 || a.respawn <= 0) continue;
    a.respawn -= dt;
    if (a.respawn <= 0) {
      const c = centers[Math.floor(rand(s) * centers.length)];
      const fresh = spawnAsteroid(s, () => rand(s), c, sys, Math.min(0.3, scouts * 0.06));
      s.asteroids[i] = fresh;
    }
  }
}

function reserves(s: GameState, dt: number) {
  const cd = 1 - 0.2 * lvl(s, 'reserveCd');
  const defs: [ShipClass, number, number][] = [
    ['drone', 2 * lvl(s, 'reserveDrone'), 120 * cd],
    ['fighter', lvl(s, 'reserveFighter'), 300 * cd],
  ];
  for (const [cls, min, cooldown] of defs) {
    if (min <= 0 || !s.unlocked.includes(cls)) continue;
    const n = s.ships.filter((x) => x.cls === cls).length;
    if (n >= min) {
      s.reserveTimers[cls] = cooldown;
      continue;
    }
    const t = (s.reserveTimers[cls] ?? cooldown) - dt;
    s.reserveTimers[cls] = t;
    if (t <= 0) {
      if (createShip(s, cls))
        log(s, `Reserve rebuilt a ${SHIP_STATS[cls].name.toLowerCase()}.`, 'good');
      s.reserveTimers[cls] = cooldown;
    }
  }
}

function drift(s: GameState, dt: number) {
  const c = s.carrier;
  if (c.stance === 'followRich' && (!c.target || Math.round(s.time / DT) % 300 === 0)) {
    let best: Vec3 | null = null;
    let bv = 0;
    for (const cc of clusterCenters(s.systems[s.systemId])) {
      if (inHazard(s, cc)) continue;
      const v = oreNear(s, cc, 14) / (dist(cc, c.pos) + 30);
      if (v > bv) {
        bv = v;
        best = cc;
      }
    }
    if (best) {
      // park just short of the cluster so it sits inside carrier cover
      const d = dist(best, c.pos) || 1;
      const f = Math.max(0, (d - 22) / d);
      c.target = { x: c.pos.x + (best.x - c.pos.x) * f, y: 0, z: c.pos.z + (best.z - c.pos.z) * f };
    } else c.target = null;
  }
  if (c.stance === 'hold') c.target = null;
  if (c.target && c.energy > maxEnergy(s) * 0.1) {
    if (!moveToward(c.pos, c.target, 1.2 * dt)) c.energy -= 1 * dt;
  }
}

function carrierDisabled(s: GameState) {
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

function warpStep(s: GameState, dt: number) {
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
