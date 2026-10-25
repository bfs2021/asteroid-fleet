import { useState } from 'react';
import { engine, useGame } from '../game/engine';
import { RETROFIT_COST, shipCost } from '../sim/actions';
import { HANGAR_SLOT_COST, HANGAR_TYPES, MAX_HANGAR_SLOTS, NEW_HANGAR_COST, SHIP_STATS } from '../sim/config';
import { effectiveStance, stanceSource } from '../sim/doctrine';
import { neighbours, occupancy } from '../sim/hangar';
import { maxHull } from '../sim/state';
import { cargoCap } from '../sim/tick';
import { SHIP_CLASSES, type GameState, type Hangar, type HangarType, type Ship, type ShipClass } from '../sim/types';
import { fmt } from './Hud';

const MODE_LABEL: Record<string, string> = {
  docked: 'docked',
  idle: 'idle',
  toAsteroid: 'to rock',
  mining: 'mining',
  toDropoff: 'to barge',
  toBarge: 'to barge',
  toCarrier: 'returning',
  station: 'on station',
  escort: 'escorting',
  attack: 'attacking',
  patrol: 'patrol',
  repairing: 'repairing',
  retreat: 'retreating',
  recall: 'recalled',
};

const UNLOCK_HINT: Partial<Record<ShipClass, string>> = {
  fighter: 'Reach the frontier',
  repair: 'Reach the frontier',
  harvester: 'Research the fusion reactor',
};

function synergy(s: GameState, h: Hangar, ship: Ship): string | null {
  const adj = neighbours(s, h, ship.id).map((id) => s.ships.find((x) => x.id === id)?.cls);
  if ((ship.cls === 'fighter' || ship.cls === 'barge') && adj.includes('repair')) return 'Repair drone adjacent: repairs 3× faster when docked';
  if (ship.cls === 'repair' && (adj.includes('fighter') || adj.includes('barge'))) return 'Boosting the repairs of its neighbours';
  return null;
}

function HangarBoard({ h, selected, onSelect, selShip, onShip }: { h: Hangar; selected: boolean; onSelect: () => void; selShip: number; onShip: (id: number) => void }) {
  const s = useGame();
  const [over, setOver] = useState(-1);
  const occ = occupancy(s, h);
  const cells: React.ReactNode[] = [];
  const drop = (e: React.DragEvent, start: number) => {
    e.preventDefault();
    setOver(-1);
    const id = Number(e.dataTransfer.getData('text/ship'));
    if (id) engine.dispatch({ type: 'moveShip', shipId: id, hangarId: h.id, start });
  };
  for (let i = 0; i < h.slots; i++) {
    const id = occ[i];
    if (id === null) {
      cells.push(
        <div
          key={'e' + i}
          className={`slot ${over === i ? 'drop' : ''}`}
          style={{ gridColumn: `${i + 1}` }}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(i);
          }}
          onDragLeave={() => setOver(-1)}
          onDrop={(e) => drop(e, i)}
          onClick={onSelect}
        />,
      );
      continue;
    }
    if (i > 0 && occ[i - 1] === id) continue;
    const ship = s.ships.find((x) => x.id === id)!;
    const st = SHIP_STATS[ship.cls];
    const syn = synergy(s, h, ship);
    cells.push(
      <div
        key={'s' + id}
        className={`ship-tile ${ship.mode !== 'docked' ? 'out' : ''} ${selShip === id ? 'sel' : ''}`}
        style={{ gridColumn: `${i + 1} / span ${st.slots}`, background: st.color }}
        draggable
        onDragStart={(e) => e.dataTransfer.setData('text/ship', String(id))}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(i);
        }}
        onDrop={(e) => drop(e, i)}
        onClick={() => onShip(id)}
        title={`${st.name}${syn ? ' · ' + syn : ''}`}
      >
        <span className="nm">{st.slots >= 4 ? st.name : st.short}</span>
        <span className="md">{MODE_LABEL[ship.mode]}</span>
        {syn && <span className="synergy">✚</span>}
        <span className="hp" style={{ width: `${(ship.hull / maxHull(s, ship.cls)) * 100}%` }} />
      </div>,
    );
  }
  const def = HANGAR_TYPES[h.type];
  const order = h.launchOrder;
  const swap = (i: number, j: number) => {
    if (j < 0 || j >= order.length) return;
    const next = [...order];
    [next[i], next[j]] = [next[j], next[i]];
    engine.dispatch({ type: 'setLaunchOrder', hangarId: h.id, order: next });
  };
  const used = occ.filter((x) => x !== null).length;
  return (
    <div className={`hangar ${selected ? 'selected' : ''}`} onClick={(e) => e.target === e.currentTarget && onSelect()}>
      <div className="hangar-head">
        <span className="title">Hangar {h.id}</span>
        <select
          value={h.type}
          onChange={(e) => engine.dispatch({ type: 'retrofitHangar', hangarId: h.id, hangarType: e.target.value as HangarType })}
          title={`Retrofit for ${RETROFIT_COST} credits`}
        >
          {(Object.keys(HANGAR_TYPES) as HangarType[]).map((t) => (
            <option key={t} value={t} disabled={t === 'drydock' && s.stats.furthestTier < 2}>
              {HANGAR_TYPES[t].name}
            </option>
          ))}
        </select>
        <span className="blurb grow">{def.blurb}</span>
        <span className="blurb">{used}/{h.slots}</span>
        <button
          disabled={h.slots >= MAX_HANGAR_SLOTS || s.credits < HANGAR_SLOT_COST(h.slots)}
          onClick={() => engine.dispatch({ type: 'buySlot', hangarId: h.id })}
          title="Buy one more slot"
        >
          +slot {fmt(HANGAR_SLOT_COST(h.slots))}
        </button>
      </div>
      <div className="board" style={{ ['--slots' as string]: h.slots }} onClick={onSelect}>
        {cells}
      </div>
      <div className="row" style={{ marginTop: 6 }}>
        <span className="blurb">Launch order</span>
        <div className="order">
          {order
            .filter((c) => s.unlocked.includes(c))
            .map((c) => {
              const i = order.indexOf(c);
              return (
                <span key={c}>
                  <button onClick={() => swap(i, i - 1)}>◀</button>
                  <i className="swatch" style={{ background: SHIP_STATS[c].color }} />
                  {SHIP_STATS[c].short}
                  <button onClick={() => swap(i, i + 1)}>▶</button>
                </span>
              );
            })}
        </div>
      </div>
    </div>
  );
}

function ShipDetail({ id }: { id: number }) {
  const s = useGame();
  const ship = s.ships.find((x) => x.id === id);
  if (!ship) return null;
  const st = effectiveStance(s, ship);
  const src = (k: 'engagement' | 'underFire' | 'mining') => stanceSource(s, ship, k);
  const cap = cargoCap(s, ship.cls);
  return (
    <div className="hangar" style={{ borderColor: SHIP_STATS[ship.cls].color }}>
      <div className="hangar-head">
        <span className="title">{SHIP_STATS[ship.cls].name} #{ship.id}</span>
        <span className="blurb grow">{SHIP_STATS[ship.cls].role}</span>
        <button disabled={ship.mode !== 'docked'} onClick={() => engine.dispatch({ type: 'scrapShip', shipId: id })} title="Scrap for 50 % of base cost (docked only)">
          Scrap
        </button>
      </div>
      <div className="hint">
        {MODE_LABEL[ship.mode]} · hull {Math.round(ship.hull)}/{Math.round(maxHull(s, ship.cls))}
        {cap > 0 && <> · cargo {Math.round(ship.cls === 'harvester' ? ship.h2 : ship.cargo)}/{Math.round(cap)}</>}
        <br />
        Stance: {st.engagement} <small>({src('engagement')})</small> · {st.underFire === 'retreatHull' ? `retreat at ${Math.round(st.retreatAt * 100)} %` : st.underFire}{' '}
        <small>({src('underFire')})</small> · {st.mining} <small>({src('mining')})</small>
      </div>
    </div>
  );
}

export function FleetPanel() {
  const s = useGame();
  const [sel, setSel] = useState(s.hangars[0]?.id ?? 1);
  const [selShip, setSelShip] = useState(-1);
  const hangarCount = s.hangars.length;
  return (
    <>
      <h3>Shipyard · builds into Hangar {sel}</h3>
      <div className="shop">
        {SHIP_CLASSES.map((c) => {
          const st = SHIP_STATS[c];
          const unlocked = s.unlocked.includes(c);
          const cost = shipCost(s, c);
          const count = s.ships.filter((x) => x.cls === c).length;
          return (
            <button
              key={c}
              disabled={!unlocked || s.credits < cost}
              onClick={() => engine.dispatch({ type: 'buyShip', cls: c, hangarId: sel })}
              title={st.role}
            >
              <span>
                <i className="swatch" style={{ background: st.color }} />
                {st.name}
              </span>
              <span className="meta">
                {unlocked ? (
                  <>
                    <span className="cost">{fmt(cost)} cr</span> · {st.slots} slot{st.slots > 1 ? 's' : ''} · ×{count}
                  </>
                ) : (
                  UNLOCK_HINT[c] ?? 'Locked'
                )}
              </span>
            </button>
          );
        })}
      </div>
      <h3>Hangars</h3>
      <p className="hint">
        Hangar slots are the board. Drag ships between slots; put a repair drone next to fighters or barges and they repair 3× faster when docked. Click a hangar to build into it.
      </p>
      {s.hangars.map((h) => (
        <div key={h.id}>
          <HangarBoard h={h} selected={sel === h.id} onSelect={() => setSel(h.id)} selShip={selShip} onShip={(id) => setSelShip(id === selShip ? -1 : id)} />
          {selShip >= 0 && h.items.some((it) => it.shipId === selShip) && <ShipDetail id={selShip} />}
        </div>
      ))}
      {hangarCount < 5 && (
        <>
          <h3>New hangar · {fmt(NEW_HANGAR_COST(hangarCount))} cr</h3>
          <div className="row">
            {(Object.keys(HANGAR_TYPES) as HangarType[]).map((t) => (
              <button
                key={t}
                disabled={s.credits < NEW_HANGAR_COST(hangarCount) || (t === 'drydock' && s.stats.furthestTier < 2)}
                onClick={() => engine.dispatch({ type: 'buyHangar', hangarType: t })}
                title={HANGAR_TYPES[t].blurb}
              >
                {HANGAR_TYPES[t].name}
              </button>
            ))}
          </div>
        </>
      )}
    </>
  );
}
