import { describe, expect, it } from 'vitest';
import { SEVERITY } from '../sim/state';
import type { EventData, Severity, SimEvent, SimEventKind } from '../sim/types';
import { TOAST_MS, TOAST_POLICY, VISIBLE_CAP, ToastQueue, offerToasts, wantsToast } from './toasts';

function ev<K extends SimEventKind>(
  kind: K,
  data: EventData[K],
  extra: { carrierId?: number; count?: number; severity?: Severity; t?: number } = {},
): SimEvent {
  return {
    kind,
    carrierId: extra.carrierId ?? 0,
    systemId: 0,
    severity: extra.severity ?? SEVERITY[kind],
    t: extra.t ?? 0,
    count: extra.count ?? 1,
    data,
  } as SimEvent;
}

function queueAt(now: { t: number }) {
  return new ToastQueue(() => now.t);
}

function lost(cls: EventData['ShipLost']['cls'], count: number) {
  return ev('ShipLost', { cls, cause: 'destroyed' }, { count });
}

function bus(event: SimEvent, id: number): SimEvent & { id: number } {
  return { ...event, id };
}

describe('toast policy', () => {
  it('names a policy for every event kind', () => {
    expect(Object.keys(TOAST_POLICY).sort()).toEqual(Object.keys(SEVERITY).sort());
  });

  it('toasts critical events, waves, jumps and welcome, and leaves the rest in the inbox', () => {
    const focused = 0;
    const toasting: SimEventKind[] = [];
    const inbox: SimEventKind[] = [];
    for (const kind of Object.keys(TOAST_POLICY) as SimEventKind[]) {
      if (kind === 'ShipLost' || kind === 'StormStarted') continue;
      const sample = sampleOf(kind);
      (wantsToast(sample, focused) ? toasting : inbox).push(kind);
    }
    expect(toasting.sort()).toEqual(
      [
        'EmergencyJump',
        'PirateWaveIncoming',
        'PiratesArrived',
        'WarpCharging',
        'Warped',
        'WelcomeBack',
      ].sort(),
    );
    expect(inbox).toEqual(
      expect.arrayContaining([
        'ReserveRebuilt',
        'ShipRebuilt',
        'VeinFound',
        'HazardCharted',
        'BargeFallback',
        'Legacy',
      ]),
    );
    expect(inbox).not.toEqual(expect.arrayContaining(toasting));
  });

  it('toasts ShipLost for a barge or when at least three ships were lost', () => {
    expect(wantsToast(lost('drone', 1), 0)).toBe(false);
    expect(wantsToast(lost('drone', 2), 0)).toBe(false);
    expect(wantsToast(lost('fighter', 3), 0)).toBe(true);
    expect(wantsToast(lost('barge', 1), 0)).toBe(true);
  });

  it('toasts StormStarted only for the focused carrier, and a jump on any carrier', () => {
    const storm = (carrierId: number) => ev('StormStarted', { h2: false }, { carrierId });
    expect(wantsToast(storm(0), 0)).toBe(true);
    expect(wantsToast(storm(1), 0)).toBe(false);
    expect(wantsToast(ev('Warped', { system: 'Lumen' }, { carrierId: 1 }), 0)).toBe(true);
    expect(wantsToast(ev('WarpCharging', { system: 'Lumen' }, { carrierId: 2 }), 0)).toBe(true);
  });

  it('toasts a critical event even when its kind is inbox-only', () => {
    const critical = ev('VeinFound', { veins: 1 }, { severity: 'critical' });
    expect(TOAST_POLICY.VeinFound).toBe('inbox');
    expect(wantsToast(critical, 0)).toBe(true);
  });
});

describe('toast queue', () => {
  it('shows at most three, newest on top, and holds the rest', () => {
    const now = { t: 0 };
    const q = queueAt(now);
    for (const text of ['A', 'B', 'C', 'D', 'E']) {
      q.push({ text, severity: 'info', carrierId: null });
      now.t += 1;
    }
    expect(q.shown(now.t).map((t) => t.text)).toEqual(['E', 'D', 'C']);
    expect(q.shown(now.t)).toHaveLength(VISIBLE_CAP);
    expect(q.waiting).toBe(2);
    // C was shown at t=2, so it expires at t=3002 and the newest waiter returns underneath.
    expect(q.shown(2 + TOAST_MS.info).map((t) => t.text)).toEqual(['E', 'D', 'B']);
    expect(q.waiting).toBe(1);
  });

  it('updates a merged event in place, restarts its timer, and does not stack a duplicate', () => {
    const now = { t: 0 };
    const q = queueAt(now);
    q.push({ eventId: 7, text: 'one drone', severity: 'warn', carrierId: 0 });
    now.t = 5_000;
    q.push({ eventId: 7, text: 'three drones', severity: 'warn', carrierId: 0 });
    expect(q.shown(now.t)).toHaveLength(1);
    expect(q.shown(now.t)[0].text).toBe('three drones');
    expect(q.shown(now.t + TOAST_MS.warn - 1)).toHaveLength(1);
    expect(q.shown(now.t + TOAST_MS.warn)).toEqual([]);
  });

  it('keeps a critical toast until it is dismissed', () => {
    const now = { t: 0 };
    const q = queueAt(now);
    const key = q.push({
      eventId: 1,
      text: 'Pirates have arrived!',
      severity: 'critical',
      carrierId: 3,
    });
    expect(q.shown(1e12)).toHaveLength(1);
    expect(q.shown(1e12)[0].severity).toBe('critical');
    q.dismiss(key);
    expect(q.shown(1e12)).toEqual([]);
  });

  it('drops info and good after 3s and warn after 6s', () => {
    const now = { t: 100 };
    const q = queueAt(now);
    q.push({ text: 'info', severity: 'info', carrierId: null });
    q.push({ text: 'good', severity: 'good', carrierId: null });
    q.push({ text: 'warn', severity: 'warn', carrierId: null });
    expect(q.shown(now.t + TOAST_MS.info - 1).map((t) => t.text)).toEqual(['warn', 'good', 'info']);
    expect(q.shown(now.t + TOAST_MS.info).map((t) => t.text)).toEqual(['warn']);
    expect(q.shown(now.t + TOAST_MS.warn - 1).map((t) => t.text)).toEqual(['warn']);
    expect(q.shown(now.t + TOAST_MS.warn)).toEqual([]);
  });

  it('brings back the newest waiting toast when the one on top closes', () => {
    const now = { t: 0 };
    const q = queueAt(now);
    q.push({ text: 'A', severity: 'info', carrierId: 0 });
    now.t = 1;
    q.push({ text: 'B', severity: 'info', carrierId: 0 });
    now.t = 2;
    q.push({ text: 'C', severity: 'info', carrierId: 0 });
    now.t = 3;
    q.push({ text: 'D', severity: 'info', carrierId: 4 });
    expect(q.shown(now.t).map((t) => t.text)).toEqual(['D', 'C', 'B']);
    expect(q.goTo(q.shown(now.t)[0].key)).toBe(4);
    expect(q.shown(now.t).map((t) => t.text)).toEqual(['C', 'B', 'A']);
  });

  it('does not let a lesser toast cover a critical one', () => {
    const q = new ToastQueue(() => 0);
    q.push({ text: 'crit', severity: 'critical', carrierId: 1 });
    q.push({ text: 'a', severity: 'info', carrierId: null });
    q.push({ text: 'b', severity: 'info', carrierId: null });
    q.push({ text: 'c', severity: 'info', carrierId: null });
    const texts = q.shown(0).map((t) => t.text);
    expect(texts).toEqual(['c', 'b', 'crit']);
    expect(q.waiting).toBe(1);
  });

  it('Go to closes the toast and returns its carrier', () => {
    const q = new ToastQueue(() => 0);
    const key = q.push({
      eventId: 4,
      text: 'Warped to Lumen.',
      severity: 'good',
      carrierId: 6,
    });
    expect(q.goTo(key)).toBe(6);
    expect(q.shown(0)).toEqual([]);
    expect(q.goTo(key)).toBeNull();
  });

  it('puts the newest severe event on top and skips inbox-only kinds', () => {
    const q = new ToastQueue(() => 0);
    offerToasts(
      q,
      [
        bus(ev('VeinFound', { veins: 1 }), 1),
        bus(ev('WelcomeBack', { credits: 4 }, { t: 5 }), 3),
        bus(ev('PiratesArrived', { size: 2 }, { t: 5 }), 2),
      ],
      0,
      (e) => e.kind,
    );
    expect(q.shown(0).map((t) => t.text)).toEqual(['PiratesArrived', 'WelcomeBack']);
  });

  it('does not focus an engine error, and a merge while waiting does not add a second toast', () => {
    const now = { t: 0 };
    const q = queueAt(now);
    for (let i = 0; i < VISIBLE_CAP; i++)
      q.push({ text: `v${i}`, severity: 'critical', carrierId: 0 });
    const waiting = q.push({ eventId: 9, text: 'lost 1', severity: 'warn', carrierId: 2 });
    now.t = 50;
    const again = q.push({ eventId: 9, text: 'lost 3', severity: 'warn', carrierId: 2 });
    expect(again).toBe(waiting);
    expect(q.waiting).toBe(1);
    const error = q.push({ text: 'Autosave failed', severity: 'warn', carrierId: null });
    expect(q.goTo(error)).toBeNull();
    expect(q.waiting).toBe(1);
    expect(q.shown(now.t).some((t) => t.text === 'Autosave failed')).toBe(false);
  });
});

function sampleOf(kind: SimEventKind): SimEvent {
  switch (kind) {
    case 'CarrierOnline':
      return ev(kind, { system: 'Kestrel' });
    case 'ShipLost':
      return ev(kind, { cls: 'drone', cause: 'destroyed' });
    case 'ShipRetreating':
      return ev(kind, { cls: 'fighter' });
    case 'PirateWaveIncoming':
      return ev(kind, { size: 4, eta: 12 });
    case 'PiratesArrived':
      return ev(kind, { size: 4 });
    case 'WaveRepelled':
      return ev(kind, {});
    case 'StormStarted':
    case 'StormPassed':
      return ev(kind, { h2: false });
    case 'HazardCharted':
      return ev(kind, { hazard: 'debris' });
    case 'VeinFound':
      return ev(kind, { veins: 1 });
    case 'BargeWrecked':
    case 'BargeFallback':
    case 'WarpCancelled':
    case 'EmergencyJump':
      return ev(kind, {});
    case 'ReserveRebuilt':
      return ev(kind, { cls: 'drone' });
    case 'ShipRebuilt':
      return ev(kind, { cls: 'drone', cost: 10 });
    case 'HangarInstalled':
      return ev(kind, { hangarType: 'launch' });
    case 'WarpCharging':
    case 'Warped':
      return ev(kind, { system: 'Lumen' });
    case 'Prestiged':
      return ev(kind, { research: 3 });
    case 'WelcomeBack':
      return ev(kind, { credits: 20 });
    case 'Legacy':
      return ev(kind, { text: 'Docked.' });
    default: {
      const never: never = kind;
      return never;
    }
  }
}
