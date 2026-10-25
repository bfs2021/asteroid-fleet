// Plain, JSON-serialisable game state. The whole GameState is what gets saved.

export type ShipClass = 'drone' | 'barge' | 'hauler' | 'fighter' | 'scout' | 'repair' | 'harvester';
export const SHIP_CLASSES: ShipClass[] = ['drone', 'barge', 'hauler', 'fighter', 'scout', 'repair', 'harvester'];

export type Engagement = 'aggressive' | 'defensive' | 'escort' | 'passive';
export type UnderFire = 'stand' | 'retreatHull' | 'retreatCargo';
export type MiningStance = 'greedy' | 'safe';

export interface Stance {
  engagement: Engagement;
  underFire: UnderFire;
  /** Hull fraction (0..1) below which a ship on `retreatHull` heads home. */
  retreatAt: number;
  mining: MiningStance;
}

export interface Doctrine {
  fleet: Stance;
  byClass: Partial<Record<ShipClass, Partial<Stance>>>;
}

export type HangarType = 'launch' | 'drydock' | 'cargo';

export interface HangarItem {
  shipId: number;
  /** First slot index the ship occupies; it spans `SHIP_STATS[cls].slots` slots. */
  start: number;
}

export interface Hangar {
  id: number;
  type: HangarType;
  slots: number;
  items: HangarItem[];
  /** Per-hangar stance override; most specific scope wins. */
  stance: Partial<Stance>;
  /** Classes launch in this order; classes not listed launch last. */
  launchOrder: ShipClass[];
  launchTimer: number;
}

export type ShipMode =
  | 'docked'
  | 'idle'
  | 'toAsteroid'
  | 'mining'
  | 'toDropoff'
  | 'toBarge'
  | 'toCarrier'
  | 'station' // barge parked at a cluster, gas harvester skimming
  | 'escort'
  | 'attack'
  | 'patrol'
  | 'repairing'
  | 'retreat'
  | 'recall';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Ship {
  id: number;
  cls: ShipClass;
  hangarId: number;
  mode: ShipMode;
  pos: Vec3;
  hull: number;
  /** Ore units carried, and their total credit value. */
  cargo: number;
  cargoValue: number;
  /** H2 carried by gas harvesters. */
  h2: number;
  targetId: number; // asteroid / ship / pirate id, -1 for none
  escortId: number; // ship this one is guarding
  station: Vec3 | null; // where a barge parks
  fireCooldown: number;
}

export interface Pirate {
  id: number;
  pos: Vec3;
  hull: number;
  maxHull: number;
  damage: number;
  speed: number;
  targetId: number; // ship id, or -2 for the carrier
  fireCooldown: number;
}

export interface Asteroid {
  id: number;
  pos: Vec3;
  ore: number;
  maxOre: number;
  /** Credit value per ore unit. */
  value: number;
  radius: number;
  /** Seconds until a depleted rock refills (field keeps refilling). */
  respawn: number;
}

export interface Hazard {
  pos: Vec3;
  radius: number;
  dps: number;
  kind: 'debris' | 'radiation';
}

export interface StarSystem {
  id: number;
  name: string;
  tier: 1 | 2 | 3;
  /** Steps from the starter systems; drives pirate scaling. */
  distance: number;
  oreMult: number;
  brightness: number; // solar multiplier
  gasGiant: boolean;
  discovered: boolean;
  seed: number;
}

export type RuleId =
  | 'fightersEscortOnWave'
  | 'bargeCallHauler'
  | 'bargeFallBack'
  | 'droneUnloadAtBarge'
  | 'haulerPark'
  | 'recallOnLowShields'
  | 'reserveWarpEnergy';

export interface Rule {
  id: RuleId;
  enabled: boolean;
  /** Rule parameter (meaning depends on the rule, see RULE_DEFS). */
  param: number;
}

export type CarrierStance = 'hold' | 'followRich';

export interface Carrier {
  pos: Vec3;
  target: Vec3 | null;
  hull: number;
  maxHull: number;
  energy: number;
  shield: number; // 0..1 shield strength, drains energy when absorbing hits
  ore: number;
  oreValue: number;
  h2: number;
  stance: CarrierStance;
  /** Refinery upgrade level, bought with credits. */
  refinery: number;
}

export interface Warp {
  targetSystem: number;
  charge: number; // seconds remaining
}

export type FxKind = 'laser' | 'mine' | 'explosion' | 'repair' | 'pirateLaser' | 'warp';
export interface Fx {
  kind: FxKind;
  a: Vec3;
  b: Vec3;
  ttl: number;
}

export interface LogEntry {
  t: number;
  text: string;
  tone: 'info' | 'warn' | 'bad' | 'good';
}

export interface Stats {
  oreValueDelivered: number;
  creditsEarned: number;
  shipsLost: number;
  piratesKilled: number;
  furthestTier: number;
}

export interface GameState {
  version: number;
  seed: number;
  rng: number;
  time: number; // sim seconds this run
  nextId: number;
  credits: number;
  research: number; // unspent research points
  researchLevels: Record<string, number>;
  unlocked: ShipClass[];
  unlockedRules: RuleId[];
  carrier: Carrier;
  hangars: Hangar[];
  ships: Ship[];
  pirates: Pirate[];
  asteroids: Asteroid[];
  hazards: Hazard[];
  systems: StarSystem[];
  systemId: number;
  doctrine: Doctrine;
  rules: Rule[];
  warp: Warp | null;
  wave: { timer: number; warning: boolean; active: boolean; size: number };
  storm: { timer: number; active: number };
  reserveTimers: Partial<Record<ShipClass, number>>;
  stats: Stats;
  lifetime: { prestiges: number; researchEarned: number };
  incomeAvg: number; // rolling credits/s, used for offline settlement
  powerMode: 'balanced' | 'income' | 'defense';
  fx: Fx[];
  log: LogEntry[];
  savedAt: number; // wall-clock ms
}
