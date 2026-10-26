import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ShipClass } from '../sim/types';

export type ModelClass = ShipClass | 'pirate';

/** Kenney Space Kit (CC0) files in `public/models`; see the README there for sources. */
export const SHIP_MODEL: Record<ModelClass, string> = {
  drone: 'craft_speederA',
  scout: 'craft_racer',
  fighter: 'craft_speederD',
  hauler: 'craft_cargoA',
  barge: 'craft_cargoB',
  harvester: 'craft_miner',
  repair: 'craft_speederC',
  pirate: 'craft_speederB',
};
export const ASTEROID_MODEL = 'meteor';

/** Hull length in world units, matching the old placeholder sizes. */
export const SHIP_LENGTH: Record<ModelClass, number> = {
  drone: 2.2,
  scout: 2.9,
  fighter: 3.2,
  hauler: 4.5,
  barge: 7,
  harvester: 4.8,
  repair: 2.4,
  pirate: 3.5,
};

/** Resolved against Vite's base, so it works under `/asteroid-fleet/` on Pages. */
export function modelUrl(name: string): string {
  return `${import.meta.env.BASE_URL}models/${name}.glb`;
}

/** The kit's accent material; recoloured per class so classes stay readable. */
const ACCENT = 'metalRed';

/**
 * Bakes a glTF scene into one geometry with vertex colours, so each class is a
 * single instanced draw call. Centred, nose on +Z, scaled to `length` along Z
 * (or to a unit radius when `length` is omitted).
 */
export function bakeModel(
  scene: THREE.Object3D,
  accent?: THREE.ColorRepresentation,
  length?: number,
): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const accentColor = accent === undefined ? null : new THREE.Color(accent);
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const src = mesh.geometry;
    const groups = src.groups.length
      ? src.groups
      : [{ start: 0, count: Infinity, materialIndex: 0 }];
    const flat = src.index ? src.toNonIndexed() : src.clone();
    const total = flat.getAttribute('position').count;
    for (const grp of groups) {
      const mat = mats[grp.materialIndex ?? 0] as THREE.MeshStandardMaterial;
      const c = accentColor && mat.name === ACCENT ? accentColor : mat.color;
      const end = Math.min(total, grp.start + grp.count);
      const g = new THREE.BufferGeometry();
      for (const name of ['position', 'normal'] as const) {
        const a = flat.getAttribute(name) as THREE.BufferAttribute;
        g.setAttribute(name, new THREE.BufferAttribute(a.array.slice(grp.start * 3, end * 3), 3));
      }
      const col = new Float32Array((end - grp.start) * 3);
      for (let i = 0; i < col.length; i += 3) col.set([c.r, c.g, c.b], i);
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      parts.push(g);
    }
    flat.dispose();
  });
  const g = mergeGeometries(parts) ?? new THREE.BufferGeometry();
  for (const p of parts) p.dispose();
  g.computeBoundingBox();
  const box = g.boundingBox!;
  const center = box.getCenter(new THREE.Vector3());
  g.translate(-center.x, -center.y, -center.z);
  const size = box.getSize(new THREE.Vector3());
  const k = length ? length / size.z : 2 / Math.max(size.x, size.y, size.z);
  g.scale(k, k, k);
  g.computeBoundingSphere();
  return g;
}
