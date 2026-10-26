import { MERGE_WINDOW_S } from '../game/events';
import type { SimEvent } from '../sim/types';

export type CarrierFilter = 'all' | number;
export type SeverityFilter = 'all' | 'warn+' | 'critical';

/** One inbox row. `seq` separates rows that share a kind, carrier, and time, including Legacy lines at t=0. */
export type InboxRow = SimEvent & { seq: number };

/**
 * React key for an inbox row. Typed events are unique on kind + carrier + time, so the
 * key does not include `seq`: when the log cap drops the oldest line, the remaining
 * rows keep their keys. Legacy lines can share kind, carrier, and t, and `seq` counts
 * those from the newest so dropping an older line does not renumber the rest.
 */
export function inboxKey(row: InboxRow): string {
  if (row.kind === 'Legacy') return `Legacy-${row.carrierId}-${row.t}-${row.seq}`;
  return `${row.kind}-${row.carrierId}-${row.t}`;
}

/**
 * The Log tab reads `GameState.log`. It is saved (so a reload keeps it, including Legacy
 * lines from older saves) and already carries `carrierId`, so one list covers every carrier.
 * `engine.events` is the live bus and is empty after a reload.
 * The bus merges repeats before they are sent; the log stores each emit with `count: 1`,
 * so the inbox applies the same kind + carrier window here. Legacy lines stay separate:
 * collapsing them would hide the old text.
 */
export function mergeForInbox(events: readonly SimEvent[]): InboxRow[] {
  const open = new Map<string, { start: number; ev: InboxRow }>();
  const chronological: InboxRow[] = [];
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    if (ev.kind === 'Legacy') {
      chronological.push({ ...ev, seq: 0 });
      continue;
    }
    const key = `${ev.kind}:${ev.carrierId}`;
    const cur = open.get(key);
    const age = cur ? ev.t - cur.start : -1;
    if (cur && age >= 0 && age < MERGE_WINDOW_S) {
      cur.ev.count += ev.count;
      cur.ev.t = ev.t;
      cur.ev.systemId = ev.systemId;
      cur.ev.severity = ev.severity;
      cur.ev.data = ev.data;
    } else {
      const merged: InboxRow = { ...ev, seq: 0 };
      open.set(key, { start: ev.t, ev: merged });
      chronological.push(merged);
    }
  }
  const newestFirst: InboxRow[] = [];
  for (let i = chronological.length - 1; i >= 0; i--) newestFirst.push(chronological[i]);
  // A window's displayed time is its latest event, which can be after a group that started later.
  newestFirst.sort((a, b) => b.t - a.t);
  // Count Legacy rows from the newest. Dropping an older line leaves those keys alone.
  let legacySeq = 0;
  for (const row of newestFirst) {
    if (row.kind === 'Legacy') row.seq = legacySeq++;
  }
  return newestFirst;
}

/** The selected carrier, or All when that carrier is no longer in the run. */
export function activeCarrier(carrier: CarrierFilter, ids: readonly number[]): CarrierFilter {
  if (carrier === 'all' || ids.includes(carrier)) return carrier;
  return 'all';
}

/** `warn+` is warn and critical. The list stays newest-first. */
export function filterEvents<T extends SimEvent>(
  events: readonly T[],
  carrier: CarrierFilter,
  severity: SeverityFilter,
): T[] {
  return events.filter((ev) => {
    if (carrier !== 'all' && ev.carrierId !== carrier) return false;
    if (severity === 'critical') return ev.severity === 'critical';
    if (severity === 'warn+') return ev.severity === 'warn' || ev.severity === 'critical';
    return true;
  });
}

/** One option per carrier: the system name, or `Carrier <id>` when it has none. Shared names keep the id. */
export function carrierChoices(
  ops: readonly { id: number; systemId: number }[],
  systems: readonly { name: string }[],
): { id: number; label: string }[] {
  const base = ops.map((op) => systems[op.systemId]?.name || `Carrier ${op.id}`);
  const seen = new Map<string, number>();
  for (const name of base) seen.set(name, (seen.get(name) ?? 0) + 1);
  return ops.map((op, i) => ({
    id: op.id,
    label: (seen.get(base[i]) ?? 0) > 1 ? `${base[i]} (${op.id})` : base[i],
  }));
}
