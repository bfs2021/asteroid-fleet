import type { GameState, Rule, RuleId, Ship, Stance } from './types';

export function rule(s: GameState, id: RuleId): Rule | null {
  const r = s.rules.find((x) => x.id === id);
  return r && r.enabled && s.unlockedRules.includes(id) ? r : null;
}

/** Fleet doctrine < ship type < hangar < active rule. The most specific scope wins. */
export function effectiveStance(s: GameState, ship: Ship): Stance {
  const hangar = s.hangars.find((h) => h.id === ship.hangarId);
  const st: Stance = { ...s.doctrine.fleet, ...s.doctrine.byClass[ship.cls], ...hangar?.stance };
  if (
    ship.cls === 'fighter' &&
    (s.wave.warning || s.wave.active) &&
    rule(s, 'fightersEscortOnWave')
  ) {
    st.engagement = 'escort';
  }
  if (!s.unlocked.includes('fighter') && st.engagement !== 'passive') {
    // Engagement stances unlock in the frontier; until then everything is defensive.
    st.engagement = 'defensive';
  }
  return st;
}

/** Which scope set the value shown for a stance axis (for the UI). */
export function stanceSource(
  s: GameState,
  ship: Ship,
  key: keyof Stance,
): 'fleet' | 'class' | 'hangar' | 'rule' {
  if (
    key === 'engagement' &&
    ship.cls === 'fighter' &&
    (s.wave.warning || s.wave.active) &&
    rule(s, 'fightersEscortOnWave')
  )
    return 'rule';
  const hangar = s.hangars.find((h) => h.id === ship.hangarId);
  if (hangar?.stance[key] !== undefined) return 'hangar';
  if (s.doctrine.byClass[ship.cls]?.[key] !== undefined) return 'class';
  return 'fleet';
}
