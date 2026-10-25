import {
  DEFAULT_STANCE,
  ENERGY_MAX,
  ORE_BY_TIER,
  RULE_DEFS,
  SHIP_STATS,
  STARTER_RULES,
  ZONE_RULE_UNLOCKS,
  ZONE_UNLOCKS,
} from './config';
import { findSpace } from './hangar';
import { onSphere, seeded, v3 } from './math';
import { lvl } from './research';
import type { Asteroid, GameState, Hangar, Hazard, RuleId, Ship, ShipClass, StarSystem, Vec3 } from './types';

export const SAVE_VERSION = 1;

const NAMES = ['Kestrel', 'Lumen', 'Harrow', 'Vesper', 'Cinder', 'Tamsin', 'Orrery', 'Ashfall', 'Nadir', 'Umbra'];

export function makeSystems(seed: number): StarSystem[] {
  const r = seeded(seed ^ 0x51f15e);
  const layout: { tier: 1 | 2 | 3; distance: number; gas?: boolean }[] = [
    { tier: 1, distance: 0 },
    { tier: 1, distance: 1 },
    { tier: 2, distance: 2 },
    { tier: 2, distance: 3, gas: true },
    { tier: 2, distance: 3 },
    { tier: 2, distance: 4 },
    { tier: 3, distance: 5 },
    { tier: 3, distance: 6, gas: true },
    { tier: 3, distance: 6 },
    { tier: 3, distance: 7 },
  ];
  return layout.map((l, i) => ({
    id: i,
    name: `${NAMES[i]} ${['I', 'II', 'III', 'IV'][Math.floor(r() * 4)]}`,
    tier: l.tier,
    distance: l.distance,
    oreMult: 1 + l.distance * 0.12,
    brightness: Math.round((0.6 + r() * 0.9) * 100) / 100,
    gasGiant: !!l.gas,
    discovered: l.distance <= 1,
    seed: Math.floor(r() * 1e9),
  }));
}

export function gasGiantPos(sys: StarSystem): Vec3 {
  const r = seeded(sys.seed ^ 0x9a5);
  const a = r() * Math.PI * 2;
  return { x: Math.cos(a) * 120, y: -10, z: Math.sin(a) * 120 };
}

function pickOre(r: () => number, tier: number) {
  const table = ORE_BY_TIER[tier];
  const total = table.reduce((a, o) => a + o.weight, 0);
  let x = r() * total;
  for (const o of table) {
    x -= o.weight;
    if (x <= 0) return o;
  }
  return table[0];
}

export function spawnAsteroid(s: GameState, r: () => number, center: Vec3, sys: StarSystem, richBonus = 0): Asteroid {
  const off = onSphere(r, 9, 0.6);
  const pos = { x: center.x + off.x, y: center.y + off.y, z: center.z + off.z };
  const far = Math.sqrt(center.x * center.x + center.z * center.z);
  const ore = pickOre(r, sys.tier);
  const maxOre = Math.round(80 + r() * 220);
  return {
    id: s.nextId++,
    pos,
    ore: maxOre,
    maxOre,
    value: ore.value * sys.oreMult * (1 + far / 140) * (1 + 0.1 * lvl(s, 'rich')) * (1 + richBonus),
    radius: 0.8 + (maxOre / 300) * 1.6,
    respawn: 0,
  };
}

/** Cluster centres for a system; the field keeps refilling around them. */
export function clusterCenters(sys: StarSystem): Vec3[] {
  const r = seeded(sys.seed);
  const out: Vec3[] = [];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + r() * 0.6;
    const d = 22 + i * 10 + r() * 8;
    out.push({ x: Math.cos(a) * d, y: (r() - 0.5) * 10, z: Math.sin(a) * d });
  }
  return out;
}

export function enterSystem(s: GameState, id: number) {
  const sys = s.systems[id];
  s.systemId = id;
  s.pirates = [];
  s.fx = [];
  s.carrier.pos = v3();
  s.carrier.target = null;
  s.asteroids = [];
  const r = seeded(sys.seed);
  for (const c of clusterCenters(sys)) {
    const n = 8 + Math.floor(r() * 6);
    for (let i = 0; i < n; i++) s.asteroids.push(spawnAsteroid(s, r, c, sys));
  }
  s.hazards = [];
  const hz = sys.tier === 1 ? 0 : sys.tier === 2 ? 2 : 3;
  for (let i = 0; i < hz; i++) {
    const p = onSphere(r, 90, 0.2);
    const h: Hazard = { pos: p, radius: 10 + r() * 10, dps: sys.tier === 2 ? 2 : 6, kind: sys.tier === 2 ? 'debris' : 'radiation' };
    if (Math.hypot(p.x, p.z) > 25) s.hazards.push(h);
  }
  s.wave = { timer: sys.tier === 1 ? Infinity : 60, warning: false, active: false, size: 0 };
  s.storm = { timer: sys.tier >= 2 ? 90 + r() * 60 : Infinity, active: 0 };
  for (const o of s.systems) if (o.distance <= sys.distance + 1) o.discovered = true;
  if (sys.tier > s.stats.furthestTier) s.stats.furthestTier = sys.tier;
  for (let t = 1; t <= sys.tier; t++) {
    for (const c of ZONE_UNLOCKS[t]) if (!s.unlocked.includes(c)) s.unlocked.push(c);
    for (const rid of ZONE_RULE_UNLOCKS[t]) unlockRule(s, rid);
  }
}

export function unlockRule(s: GameState, id: RuleId) {
  if (!s.unlockedRules.includes(id)) s.unlockedRules.push(id);
  if (!s.rules.some((r) => r.id === id)) {
    s.rules.push({ id, enabled: STARTER_RULES.includes(id), param: RULE_DEFS[id].defaultParam });
  }
}

export function maxHull(s: GameState, cls: ShipClass): number {
  let h = SHIP_STATS[cls].hull * (1 + 0.15 * lvl(s, 'armor'));
  if (cls === 'barge' && lvl(s, 'bargeBay') > 0) h *= 1.5;
  return h;
}

export function maxEnergy(s: GameState): number {
  return ENERGY_MAX * (1 + 0.25 * lvl(s, 'energyCap'));
}

export function createShip(s: GameState, cls: ShipClass, preferredHangar?: number, start?: number): Ship | null {
  let hangar: Hangar | undefined;
  let at = start ?? -1;
  if (preferredHangar !== undefined && start !== undefined) {
    hangar = s.hangars.find((h) => h.id === preferredHangar);
  } else {
    const space = findSpace(s, cls, preferredHangar);
    if (!space) return null;
    hangar = space.hangar;
    at = space.start;
  }
  if (!hangar || at < 0) return null;
  const ship: Ship = {
    id: s.nextId++,
    cls,
    hangarId: hangar.id,
    mode: 'docked',
    pos: { ...s.carrier.pos },
    hull: maxHull(s, cls),
    cargo: 0,
    cargoValue: 0,
    h2: 0,
    targetId: -1,
    escortId: -1,
    station: null,
    fireCooldown: 0,
  };
  s.ships.push(ship);
  hangar.items.push({ shipId: ship.id, start: at });
  return ship;
}

export function log(s: GameState, text: string, tone: 'info' | 'warn' | 'bad' | 'good' = 'info') {
  s.log.unshift({ t: s.time, text, tone });
  if (s.log.length > 40) s.log.length = 40;
}

interface Carry {
  research: number;
  researchLevels: Record<string, number>;
  unlocked: ShipClass[];
  unlockedRules: RuleId[];
  discovered: number[];
  lifetime: GameState['lifetime'];
  doctrine?: GameState['doctrine'];
  rules?: GameState['rules'];
}

export function newGame(seed = 1337, carry?: Carry): GameState {
  const slotsBonus = carry?.researchLevels.slots ?? 0;
  const s: GameState = {
    version: SAVE_VERSION,
    seed,
    rng: seed,
    time: 0,
    nextId: 1,
    credits: 150 + 250 * (carry?.researchLevels.startCredits ?? 0),
    research: carry?.research ?? 0,
    researchLevels: carry?.researchLevels ?? {},
    unlocked: carry?.unlocked ?? [],
    unlockedRules: [],
    carrier: {
      pos: v3(),
      target: null,
      hull: 2000,
      maxHull: 2000,
      energy: ENERGY_MAX * 0.6,
      shield: 1,
      ore: 0,
      oreValue: 0,
      h2: 0,
      stance: 'followRich',
      refinery: 0,
    },
    hangars: [
      { id: 1, type: 'launch', slots: 6 + slotsBonus, items: [], stance: {}, launchOrder: ['fighter', 'scout', 'drone', 'repair', 'hauler', 'barge', 'harvester'], launchTimer: 0 },
      { id: 2, type: 'cargo', slots: 6 + slotsBonus, items: [], stance: {}, launchOrder: ['fighter', 'drone', 'hauler', 'barge', 'repair', 'scout', 'harvester'], launchTimer: 0 },
    ],
    ships: [],
    pirates: [],
    asteroids: [],
    hazards: [],
    systems: makeSystems(seed),
    systemId: 0,
    doctrine: carry?.doctrine ?? { fleet: { ...DEFAULT_STANCE }, byClass: { drone: { mining: 'safe' } } },
    rules: carry?.rules ?? [],
    warp: null,
    wave: { timer: Infinity, warning: false, active: false, size: 0 },
    storm: { timer: Infinity, active: 0 },
    reserveTimers: {},
    stats: { oreValueDelivered: 0, creditsEarned: 0, shipsLost: 0, piratesKilled: 0, furthestTier: 1 },
    lifetime: carry?.lifetime ?? { prestiges: 0, researchEarned: 0 },
    incomeAvg: 0,
    powerMode: 'balanced',
    fx: [],
    log: [],
    savedAt: Date.now(),
  };
  s.unlockedRules = [];
  for (const id of carry?.unlockedRules ?? []) unlockRule(s, id);
  if (carry) for (const id of carry.discovered) if (s.systems[id]) s.systems[id].discovered = true;
  s.carrier.energy = maxEnergy(s) * 0.6;
  enterSystem(s, 0);
  for (let i = 0; i < 4; i++) createShip(s, 'drone', 1);
  log(s, 'Carrier online in ' + s.systems[0].name + '. Set your doctrine, then let the fleet work.', 'good');
  return s;
}
