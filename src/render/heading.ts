import * as THREE from 'three';
import { engine } from '../game/engine';
import type { Vec3 } from '../sim/types';

const tmpV = new THREE.Vector3();
const headings = new Map<number, THREE.Vector3>();

/** Drop headings of destroyed ships; `engine.prev` only holds live ids. */
export function pruneHeadings() {
  if (headings.size <= engine.prev.size + 64) return;
  for (const id of headings.keys()) if (!engine.prev.has(id)) headings.delete(id);
}

/** Smoothed unit direction of travel, from the last two sim snapshots. */
export function heading(id: number, cur: Vec3): THREE.Vector3 {
  const prev = engine.prev.get(id);
  let h = headings.get(id);
  if (!h) {
    h = new THREE.Vector3(0, 0, 1);
    headings.set(id, h);
  }
  if (prev) {
    tmpV.set(cur.x - prev.x, cur.y - prev.y, cur.z - prev.z);
    if (tmpV.lengthSq() > 1e-6) h.lerp(tmpV.normalize(), 0.25).normalize();
  }
  return h;
}

/** Distance moved between the last two sim snapshots (0 for new ships). */
export function stepLength(id: number, cur: Vec3): number {
  const prev = engine.prev.get(id);
  if (!prev) return 0;
  return Math.hypot(cur.x - prev.x, cur.y - prev.y, cur.z - prev.z);
}
