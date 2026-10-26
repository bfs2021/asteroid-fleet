import { SHIP_STATS } from './config';
import { shipCost } from './actions';
import { firstFit } from './hangar';
import { lvl } from './research';
import { createShip, log } from './state';
import { SHIP_CLASSES, type GameState, type Ship, type ShipClass } from './types';

/** Seconds between automation passes; buying is not urgent and boards are scanned per pass. */
export const AUTOMATION_INTERVAL = 1;

export const autoBuyUnlocked = (s: GameState) => lvl(s, 'autoBuy') > 0;
export const autoRebuildUnlocked = (s: GameState) => lvl(s, 'autoRebuild') > 0;

/** Engagement stances unlock with fighters (the frontier) or with the tactics research. */
export const engagementUnlocked = (s: GameState) =>
  s.unlocked.includes('fighter') || lvl(s, 'tactics') > 0;

/** Remember a lost ship so paid auto-rebuild can replace it. */
export function queueRebuild(s: GameState, ship: Ship) {
  if (!autoRebuildUnlocked(s)) return;
  s.automation.rebuildQueue.push({ cls: ship.cls, hangarId: ship.hangarId });
}

/** Buy one ship into `hangarId` if it fits and the credit floor holds. */
function tryBuy(s: GameState, cls: ShipClass, hangarId: number): boolean {
  if (!s.unlocked.includes(cls)) return false;
  const cost = shipCost(s, cls);
  if (s.credits - cost < s.automation.creditFloor) return false;
  const h = s.hangars.find((x) => x.id === hangarId);
  if (!h || firstFit(s, h, cls) < 0) return false;
  if (!createShip(s, cls, hangarId)) return false;
  s.credits -= cost;
  return true;
}

export function automation(s: GameState, dt: number) {
  const a = s.automation;
  a.timer -= dt;
  if (a.timer > 0) return;
  a.timer = AUTOMATION_INTERVAL;

  if (a.autoRebuild && autoRebuildUnlocked(s)) {
    // Oldest loss first; stop at the first one we cannot pay for, so order holds.
    while (a.rebuildQueue.length > 0) {
      const next = a.rebuildQueue[0];
      const home = s.hangars.some((h) => h.id === next.hangarId) ? next.hangarId : s.hangars[0].id;
      const fits = s.hangars.some((h) => firstFit(s, h, next.cls) >= 0);
      if (!fits) {
        a.rebuildQueue.shift(); // no room anywhere: the player rearranged; drop it
        continue;
      }
      const cost = shipCost(s, next.cls);
      if (!s.unlocked.includes(next.cls) || s.credits - cost < a.creditFloor) break;
      if (!createShip(s, next.cls, home)) break;
      s.credits -= cost;
      a.rebuildQueue.shift();
      log(s, `Rebuilt a ${SHIP_STATS[next.cls].name.toLowerCase()} for ${cost} credits.`, 'good');
    }
  }

  if (a.autoBuy && autoBuyUnlocked(s)) {
    // One ship per hangar per pass keeps spending spread across hangars.
    for (const h of s.hangars) {
      for (const cls of SHIP_CLASSES) {
        const want = h.target[cls] ?? 0;
        if (want <= 0) continue;
        let have = 0;
        for (const it of h.items) if (s.ships.find((x) => x.id === it.shipId)?.cls === cls) have++;
        if (have >= want) continue;
        if (tryBuy(s, cls, h.id)) break;
      }
    }
  }
}
