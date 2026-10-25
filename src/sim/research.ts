import type { GameState, ShipClass } from './types';

export type Branch = 'Logistics' | 'Mining' | 'Combat' | 'Carrier' | 'Reserves' | ShipClass;

export interface ResearchNode {
  id: string;
  branch: Branch;
  name: string;
  desc: string;
  maxLevel: number;
  cost: (level: number) => number; // cost of buying the next level
  requires?: string;
}

const lin = (base: number, step: number) => (lvl: number) => base + step * lvl;

export const RESEARCH: ResearchNode[] = [
  // Global branches carry the steady incremental growth.
  {
    id: 'bargeCap',
    branch: 'Logistics',
    name: 'Compression',
    desc: '+20 % barge capacity',
    maxLevel: 5,
    cost: lin(1, 1),
  },
  {
    id: 'haulSpeed',
    branch: 'Logistics',
    name: 'Hauler thrusters',
    desc: '+12 % hauler speed',
    maxLevel: 5,
    cost: lin(1, 1),
  },
  {
    id: 'yield',
    branch: 'Mining',
    name: 'Drill heads',
    desc: '+15 % mining yield',
    maxLevel: 8,
    cost: lin(1, 1),
  },
  {
    id: 'droneCargo',
    branch: 'Mining',
    name: 'Drone holds',
    desc: '+20 % drone cargo',
    maxLevel: 5,
    cost: lin(1, 1),
  },
  {
    id: 'rich',
    branch: 'Mining',
    name: 'Vein mapping',
    desc: '+10 % ore value',
    maxLevel: 5,
    cost: lin(2, 2),
    requires: 'yield',
  },
  {
    id: 'damage',
    branch: 'Combat',
    name: 'Pulse lasers',
    desc: '+15 % fighter damage',
    maxLevel: 5,
    cost: lin(1, 1),
  },
  {
    id: 'armor',
    branch: 'Combat',
    name: 'Composite armor',
    desc: '+15 % hull for all ships',
    maxLevel: 5,
    cost: lin(1, 1),
  },
  {
    id: 'repair',
    branch: 'Combat',
    name: 'Field repair',
    desc: '+30 % repair speed',
    maxLevel: 3,
    cost: lin(1, 2),
  },
  {
    id: 'energyCap',
    branch: 'Carrier',
    name: 'Capacitors',
    desc: '+25 % energy capacity',
    maxLevel: 5,
    cost: lin(1, 1),
  },
  {
    id: 'solar',
    branch: 'Carrier',
    name: 'Solar sails',
    desc: '+20 % solar recharge',
    maxLevel: 5,
    cost: lin(1, 1),
  },
  {
    id: 'warpCharge',
    branch: 'Carrier',
    name: 'Jump spool',
    desc: '-15 % warp charge time',
    maxLevel: 3,
    cost: lin(2, 1),
  },
  {
    id: 'fusion',
    branch: 'Carrier',
    name: 'Fusion reactor',
    desc: 'Burns H2 from gas giants for energy; unlocks the gas harvester',
    maxLevel: 1,
    cost: () => 4,
  },
  {
    id: 'slots',
    branch: 'Carrier',
    name: 'Hangar frames',
    desc: 'Every run starts with +1 slot per hangar',
    maxLevel: 3,
    cost: lin(2, 2),
  },
  {
    id: 'startCredits',
    branch: 'Carrier',
    name: 'Venture capital',
    desc: '+250 starting credits',
    maxLevel: 5,
    cost: lin(1, 1),
  },
  {
    id: 'reserveDrone',
    branch: 'Reserves',
    name: 'Drone reserve',
    desc: 'Keep at least 2 drones per level; one rebuilt every 2 min',
    maxLevel: 3,
    cost: lin(1, 1),
  },
  {
    id: 'reserveFighter',
    branch: 'Reserves',
    name: 'Fighter reserve',
    desc: 'Keep at least 1 fighter per level; one rebuilt every 5 min',
    maxLevel: 3,
    cost: lin(2, 2),
  },
  {
    id: 'reserveCd',
    branch: 'Reserves',
    name: 'Fabricator',
    desc: '-20 % rebuild cooldown',
    maxLevel: 3,
    cost: lin(2, 1),
    requires: 'reserveDrone',
  },
  // Per-class branches feed build identity on the hangar board.
  {
    id: 'droneSwarm',
    branch: 'drone',
    name: 'Swarm logic',
    desc: 'Drones mine 10 % faster per drone in the same hangar (max +50 %)',
    maxLevel: 1,
    cost: () => 3,
  },
  {
    id: 'bargeBay',
    branch: 'barge',
    name: 'Barge drone bay',
    desc: 'Barges get +50 % hull and repair docked drones',
    maxLevel: 1,
    cost: () => 3,
  },
  {
    id: 'haulerArmor',
    branch: 'hauler',
    name: 'Armored holds',
    desc: 'Haulers take 40 % less damage',
    maxLevel: 1,
    cost: () => 2,
  },
  {
    id: 'fighterAce',
    branch: 'fighter',
    name: 'Ace wings',
    desc: 'Fighters in a hangar of only fighters gain +25 % damage',
    maxLevel: 1,
    cost: () => 3,
  },
  {
    id: 'scoutRelay',
    branch: 'scout',
    name: 'Sensor relay',
    desc: 'Each scout adds +10 s pirate wave warning',
    maxLevel: 1,
    cost: () => 2,
  },
  {
    id: 'repairNano',
    branch: 'repair',
    name: 'Nano swarm',
    desc: 'Repair drones heal everything in range',
    maxLevel: 1,
    cost: () => 3,
  },
];

export const RESEARCH_BY_ID = Object.fromEntries(RESEARCH.map((r) => [r.id, r])) as Record<
  string,
  ResearchNode
>;

export function lvl(s: GameState, id: string): number {
  return s.researchLevels[id] ?? 0;
}

export function canBuyResearch(s: GameState, id: string): boolean {
  const node = RESEARCH_BY_ID[id];
  if (!node) return false;
  const l = lvl(s, id);
  if (l >= node.maxLevel) return false;
  if (node.requires && lvl(s, node.requires) === 0) return false;
  return s.research >= node.cost(l);
}

export function buyResearch(s: GameState, id: string): boolean {
  if (!canBuyResearch(s, id)) return false;
  const node = RESEARCH_BY_ID[id];
  s.research -= node.cost(lvl(s, id));
  s.researchLevels[id] = lvl(s, id) + 1;
  if (id === 'fusion' && !s.unlocked.includes('harvester')) s.unlocked.push('harvester');
  return true;
}
