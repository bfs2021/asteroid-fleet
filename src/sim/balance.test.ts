import { it } from 'vitest';
import { apply, researchPayout, shipCost } from './actions';
import { newGame } from './state';
import { step } from './tick';

it.skipIf(!process.env.BALANCE)('balance run', () => {
  const s = newGame(42);
  for (let t = 0; t < 3600 * 2 * 10; t++) {
    step(s);
    if (t % 50 === 0) {
      const drones = s.ships.filter((x) => x.cls === 'drone').length;
      const barges = s.ships.filter((x) => x.cls === 'barge').length;
      const haulers = s.ships.filter((x) => x.cls === 'hauler').length;
      if (barges < 1 && drones >= 6) apply(s, { type: 'buyShip', cls: 'barge' });
      else if (barges > haulers) apply(s, { type: 'buyShip', cls: 'hauler' });
      else if (s.credits > shipCost(s, 'drone')) { if (apply(s, { type: 'buyShip', cls: 'drone' })) apply(s, { type: 'buySlot', hangarId: s.hangars[0].id }) ; }
      apply(s, { type: 'upgradeRefinery' });
      if (s.credits > 2000 && s.hangars.length < 3) apply(s, { type: 'buyHangar', hangarType: 'launch' });
    }
    if (t % (600 * 10) === 0) {
      console.log(`t=${t / 600}min cr=${Math.round(s.credits)} inc=${s.incomeAvg.toFixed(1)}/s ore=${Math.round(s.stats.oreValueDelivered)} ships=${s.ships.length} slots=${s.hangars.map((h) => h.slots).join('/')} carrierOre=${Math.round(s.carrier.ore)} E=${Math.round(s.carrier.energy)} rp=${researchPayout(s)}`);
    }
  }
});
