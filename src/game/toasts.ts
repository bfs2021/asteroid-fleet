import type { Severity, SimEvent, SimEventKind } from '../sim/types';

/** How many toasts are on screen at once. Newer arrivals wait behind these. */
export const VISIBLE_CAP = 3;

/** How many toasts may wait for a slot. Past this, the oldest non-critical waiter is dropped. */
export const WAITING_CAP = 10;

/** Dismissed bus ids remembered so a merge in the same window does not reopen the toast. */
export const DISMISSED_CAP = 32;

/** Auto-dismiss delays. Critical toasts stay until the player closes them. */
export const TOAST_MS = {
  info: 3000,
  good: 3000,
  warn: 6000,
} as const;

/**
 * Per-kind toast policy. Per-carrier alert rules (#79) can override this table later:
 * `inbox` is the log only, `toast` always, `focused` only for the carrier on screen,
 * `bargeOrMany` for ShipLost (a barge, or three or more ships).
 * A `critical` severity toasts even when the kind says inbox.
 */
export type ToastPolicy = 'inbox' | 'toast' | 'focused' | 'bargeOrMany';

export const TOAST_POLICY: Record<SimEventKind, ToastPolicy> = {
  CarrierOnline: 'inbox',
  ShipLost: 'bargeOrMany',
  ShipRetreating: 'inbox',
  PirateWaveIncoming: 'toast',
  PiratesArrived: 'toast',
  WaveRepelled: 'inbox',
  StormStarted: 'focused',
  StormPassed: 'inbox',
  HazardCharted: 'inbox',
  VeinFound: 'inbox',
  BargeWrecked: 'inbox',
  BargeFallback: 'inbox',
  ReserveRebuilt: 'inbox',
  ShipRebuilt: 'inbox',
  HangarInstalled: 'inbox',
  WarpCharging: 'toast',
  WarpCancelled: 'inbox',
  Warped: 'toast',
  EmergencyJump: 'toast',
  Prestiged: 'inbox',
  WelcomeBack: 'toast',
  Legacy: 'inbox',
};

const SEV_RANK: Record<Severity, number> = { critical: 0, warn: 1, good: 2, info: 3 };

/** True when this event should appear as a toast for the carrier the player is watching. */
export function wantsToast(ev: SimEvent, focusedCarrierId: number): boolean {
  if (ev.severity === 'critical') return true;
  const policy = TOAST_POLICY[ev.kind];
  switch (policy) {
    case 'toast':
      return true;
    case 'focused':
      return ev.carrierId === focusedCarrierId;
    case 'bargeOrMany':
      return ev.kind === 'ShipLost' && (ev.data.cls === 'barge' || ev.count >= 3);
    case 'inbox':
      return false;
  }
}

export interface Toast {
  key: string;
  /** Bus id, so a later merge updates this toast instead of stacking another. */
  eventId: number | null;
  text: string;
  severity: Severity;
  /** Set for carrier-scoped events. Engine errors leave it null, so they have no Go to. */
  carrierId: number | null;
  /** System the event happened in, used to name the Go to button. Null for engine errors. */
  systemId: number | null;
  /** Wall-clock ms when it arrived, or when a merge restarted the timer while it was visible. */
  shownAt: number;
}

export interface ToastInput {
  eventId?: number | null;
  text: string;
  severity: Severity;
  carrierId: number | null;
  systemId?: number | null;
}

/**
 * Plain toast queue. Expiry is a timestamp check plus one timer that asks the UI to
 * re-render; the timer is cleared whenever the deadline changes, so none are left behind.
 * Visible toasts are newest-first (index 0 is the top). A new toast takes a slot and
 * the oldest lesser one waits; a critical toast stays up until it is dismissed.
 */
export class ToastQueue {
  private visible: Toast[] = [];
  private pending: Toast[] = [];
  /** Bus ids the player closed, oldest first. A later merge stays hidden unless it is more severe. */
  private dismissed: { id: number; severity: Severity }[] = [];
  private seq = 1;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private deadline: number | null = null;

  constructor(
    private now: () => number = Date.now,
    private onChange: () => void = () => {},
  ) {}

  /** How many toasts are waiting for a free slot. */
  get waiting(): number {
    return this.pending.length;
  }

  /** True when this bus id already has a toast on screen or waiting. */
  has(eventId: number): boolean {
    return this.findEvent(eventId) !== null;
  }

  /**
   * Show or, when `eventId` matches a toast already queued, update that one.
   * Returns its key, or null when the player already dismissed this id and the new
   * severity is not higher.
   */
  push(input: ToastInput): string | null {
    const now = this.now();
    if (input.eventId != null) {
      const existing = this.findEvent(input.eventId);
      if (existing) {
        existing.text = input.text;
        existing.severity = input.severity;
        existing.carrierId = input.carrierId;
        if (input.systemId !== undefined) existing.systemId = input.systemId;
        if (this.visible.includes(existing)) {
          existing.shownAt = now;
          this.schedule(now);
        }
        return existing.key;
      }
      const held = this.dismissed.find((d) => d.id === input.eventId);
      if (held && SEV_RANK[input.severity] >= SEV_RANK[held.severity]) return null;
      if (held) this.dismissed.splice(this.dismissed.indexOf(held), 1);
    }
    const toast: Toast = {
      key: input.eventId != null ? `e${input.eventId}` : `m${this.seq++}`,
      eventId: input.eventId ?? null,
      text: input.text,
      severity: input.severity,
      carrierId: input.carrierId,
      systemId: input.systemId ?? null,
      shownAt: now,
    };
    // Newest on top. A full row keeps critical toasts and waits the oldest lesser one.
    this.visible.unshift(toast);
    while (this.visible.length > VISIBLE_CAP) {
      let demote = -1;
      for (let i = this.visible.length - 1; i >= 0; i--) {
        if (this.visible[i].severity !== 'critical') {
          demote = i;
          break;
        }
      }
      const idx = demote >= 0 ? demote : this.visible.length - 1;
      const oldest = this.visible.splice(idx, 1)[0];
      if (oldest) this.pending.unshift(oldest);
    }
    this.prunePending(now);
    this.schedule(now);
    return toast.key;
  }

  /** Remove a toast. A waiting one takes its place. */
  dismiss(key: string | null) {
    if (key == null || !this.take(key)) return;
    const now = this.now();
    this.fill(now);
    this.schedule(now);
  }

  /**
   * Close the toast and return the carrier Go to should focus.
   * Null when the toast is already gone, or when it is not tied to a carrier.
   */
  goTo(key: string | null): number | null {
    if (key == null) return null;
    const toast = this.take(key);
    if (!toast) return null;
    const now = this.now();
    this.fill(now);
    this.schedule(now);
    return toast.carrierId;
  }

  /** Visible toasts after applying expiry at `now`, newest first. */
  shown(now = this.now()): readonly Toast[] {
    this.visible = this.visible.filter((t) => !expired(t, now));
    this.fill(now);
    this.schedule(now);
    return this.visible.slice();
  }

  clear() {
    this.visible = [];
    this.pending = [];
    this.dismissed = [];
    this.clearTimer();
    this.deadline = null;
  }

  private findEvent(eventId: number): Toast | null {
    return (
      this.visible.find((t) => t.eventId === eventId) ??
      this.pending.find((t) => t.eventId === eventId) ??
      null
    );
  }

  private take(key: string): Toast | null {
    const vis = this.visible.findIndex((t) => t.key === key);
    let toast: Toast | undefined;
    if (vis >= 0) toast = this.visible.splice(vis, 1)[0];
    else {
      const wait = this.pending.findIndex((t) => t.key === key);
      if (wait >= 0) toast = this.pending.splice(wait, 1)[0];
    }
    if (toast?.eventId != null) this.rememberDismissed(toast.eventId, toast.severity);
    return toast ?? null;
  }

  private rememberDismissed(id: number, severity: Severity) {
    const idx = this.dismissed.findIndex((d) => d.id === id);
    if (idx >= 0) this.dismissed.splice(idx, 1);
    this.dismissed.push({ id, severity });
    if (this.dismissed.length > DISMISSED_CAP) this.dismissed.shift();
  }

  /** The newest waiter comes back under the toasts that are already showing. */
  private fill(now: number) {
    this.prunePending(now);
    while (this.visible.length < VISIBLE_CAP && this.pending.length > 0) {
      const next = this.pending.shift();
      if (!next) break;
      if (expired(next, now)) continue;
      this.visible.push(next);
    }
  }

  /** Drop stale waiters, then the oldest non-critical ones, until the queue fits. */
  private prunePending(now: number) {
    this.pending = this.pending.filter((t) => !expired(t, now));
    while (this.pending.length > WAITING_CAP) {
      let drop = this.pending.length - 1;
      for (let i = this.pending.length - 1; i >= 0; i--) {
        if (this.pending[i].severity !== 'critical') {
          drop = i;
          break;
        }
      }
      this.pending.splice(drop, 1);
    }
  }

  /** One timer for the soonest auto-dismiss. Cleared and replaced when that moment changes. */
  private schedule(now: number) {
    let next: number | null = null;
    for (const t of this.visible) {
      if (t.severity === 'critical') continue;
      const at = t.shownAt + TOAST_MS[t.severity];
      if (next === null || at < next) next = at;
    }
    if (next === this.deadline) return;
    this.clearTimer();
    this.deadline = next;
    if (next === null) return;
    const delay = Math.max(0, next - now);
    const timer = setTimeout(() => {
      this.timer = null;
      this.deadline = null;
      this.onChange();
    }, delay);
    this.timer = timer;
    const handle = timer as unknown as { unref?: () => void };
    handle.unref?.();
  }

  private clearTimer() {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}

function expired(t: Toast, now: number): boolean {
  if (t.severity === 'critical') return false;
  return now - t.shownAt >= TOAST_MS[t.severity];
}

/**
 * Push the events that should toast, mildest and oldest first so the newest severe one
 * lands on top. A repeated bus id updates the open toast. Returns whether anything changed.
 */
export function offerToasts(
  queue: ToastQueue,
  events: readonly (SimEvent & { id: number })[],
  focusedCarrierId: number,
  text: (ev: SimEvent) => string,
): boolean {
  const ordered = events
    .slice()
    .sort((a, b) => a.t - b.t || SEV_RANK[b.severity] - SEV_RANK[a.severity]);
  let changed = false;
  for (const ev of ordered) {
    // A toast already open for this id keeps receiving merges, even when the new
    // payload would not have opened one (a barge loss followed by a drone).
    if (!wantsToast(ev, focusedCarrierId) && !queue.has(ev.id)) continue;
    const key = queue.push({
      eventId: ev.id,
      text: text(ev),
      severity: ev.severity,
      carrierId: ev.carrierId,
      systemId: ev.systemId,
    });
    if (key !== null) changed = true;
  }
  return changed;
}
