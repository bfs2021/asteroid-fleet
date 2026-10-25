import { OrbitControls, Stars } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { engine, lerpPos, useGame } from '../game/engine';
import { COVER_RADIUS, SHIP_STATS } from '../sim/config';
import { gasGiantPos } from '../sim/state';
import { SHIP_CLASSES, type ShipClass, type Vec3 } from '../sim/types';
import {
  GAS_FRAG,
  GAS_VERT,
  NEBULA_FRAG,
  NEBULA_VERT,
  asteroidGeometry,
  shipGeometry,
} from './geometry';

const MAX_PER_CLASS = 400;
const dummy = new THREE.Object3D();
const tmp: Vec3 = { x: 0, y: 0, z: 0 };
const tmpV = new THREE.Vector3();
const headings = new Map<number, THREE.Vector3>();

function heading(id: number, cur: Vec3): THREE.Vector3 {
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

export interface ViewOptions {
  tactical: boolean;
  quality: 'high' | 'low';
  onAutoTactical: (on: boolean) => void;
}

function ShipLayer({ cls }: { cls: ShipClass | 'pirate' }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const glow = useRef<THREE.InstancedMesh>(null);
  const geo = useMemo(() => shipGeometry(cls), [cls]);
  const color = cls === 'pirate' ? '#ff3b3b' : SHIP_STATS[cls].color;
  const glowColor = useMemo(
    () => new THREE.Color(cls === 'pirate' ? '#ff4020' : '#6fc8ff').multiplyScalar(4),
    [cls],
  );
  const len = cls === 'barge' ? 2.4 : cls === 'hauler' || cls === 'harvester' ? 1.6 : 1;

  useFrame(() => {
    const m = mesh.current;
    const g = glow.current;
    if (!m || !g) return;
    const s = engine.state;
    const a = engine.alpha();
    let n = 0;
    const list = cls === 'pirate' ? s.pirates : s.ships;
    for (const e of list) {
      if (cls !== 'pirate') {
        const sh = e as (typeof s.ships)[number];
        if (sh.cls !== cls || sh.mode === 'docked') continue;
      }
      if (n >= MAX_PER_CLASS) break;
      lerpPos(e.id, e.pos, a, tmp);
      const h = heading(e.id, e.pos);
      dummy.position.set(tmp.x, tmp.y, tmp.z);
      dummy.lookAt(tmp.x + h.x, tmp.y + h.y, tmp.z + h.z);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      m.setMatrixAt(n, dummy.matrix);
      dummy.position.set(tmp.x - h.x * len, tmp.y - h.y * len, tmp.z - h.z * len);
      dummy.scale.setScalar(cls === 'barge' ? 0.5 : 0.22);
      dummy.updateMatrix();
      g.setMatrixAt(n, dummy.matrix);
      n++;
    }
    m.count = n;
    g.count = n;
    m.instanceMatrix.needsUpdate = true;
    g.instanceMatrix.needsUpdate = true;
  });

  return (
    <>
      <instancedMesh ref={mesh} args={[geo, undefined, MAX_PER_CLASS]} frustumCulled={false}>
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0.35}
          metalness={0.4}
          roughness={0.45}
          flatShading
        />
      </instancedMesh>
      <instancedMesh ref={glow} args={[undefined, undefined, MAX_PER_CLASS]} frustumCulled={false}>
        <sphereGeometry args={[1, 8, 6]} />
        <meshBasicMaterial color={glowColor} toneMapped={false} />
      </instancedMesh>
    </>
  );
}

const ORE_COLORS = [
  new THREE.Color('#8b7d6b'),
  new THREE.Color('#7f8fa3'),
  new THREE.Color('#5fb3c9'),
  new THREE.Color('#b77be0'),
  new THREE.Color('#ff7df0'),
];

function Asteroids() {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const geo = useMemo(() => asteroidGeometry(), []);
  const c = useMemo(() => new THREE.Color(), []);
  useFrame((st) => {
    const m = mesh.current;
    if (!m) return;
    const t = st.clock.elapsedTime;
    let n = 0;
    for (const a of engine.state.asteroids) {
      if (a.ore <= 0) continue;
      const k = 0.45 + 0.55 * (a.ore / a.maxOre);
      dummy.position.set(a.pos.x, a.pos.y, a.pos.z);
      dummy.rotation.set(a.id * 0.7 + t * 0.05 * ((a.id % 3) - 1), a.id * 1.3 + t * 0.03, 0);
      dummy.scale.setScalar(a.radius * k);
      dummy.updateMatrix();
      m.setMatrixAt(n, dummy.matrix);
      const tier = a.value < 2 ? 0 : a.value < 5 ? 1 : a.value < 15 ? 2 : a.value < 40 ? 3 : 4;
      m.setColorAt(n, c.copy(ORE_COLORS[tier]));
      n++;
    }
    m.count = n;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  });
  return (
    <instancedMesh ref={mesh} args={[geo, undefined, 600]} frustumCulled={false}>
      <meshStandardMaterial roughness={0.95} metalness={0.05} flatShading />
    </instancedMesh>
  );
}

const MAX_SEG = 1024;
const BEAM_COLORS: Record<string, THREE.Color> = {
  mine: new THREE.Color('#7fe7ff').multiplyScalar(2.2),
  laser: new THREE.Color('#ff8fa0').multiplyScalar(3),
  pirateLaser: new THREE.Color('#ff3020').multiplyScalar(3),
  repair: new THREE.Color('#5affb4').multiplyScalar(2.5),
};

function Beams() {
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_SEG * 6), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(MAX_SEG * 6), 3));
    return g;
  }, []);
  useFrame(() => {
    const s = engine.state;
    const a = engine.alpha();
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const col = geo.getAttribute('color') as THREE.BufferAttribute;
    let n = 0;
    const push = (p: Vec3, q: Vec3, c: THREE.Color) => {
      if (n >= MAX_SEG) return;
      pos.setXYZ(n * 2, p.x, p.y, p.z);
      pos.setXYZ(n * 2 + 1, q.x, q.y, q.z);
      col.setXYZ(n * 2, c.r, c.g, c.b);
      col.setXYZ(n * 2 + 1, c.r * 0.3, c.g * 0.3, c.b * 0.3);
      n++;
    };
    const rocks = new Map(s.asteroids.map((r) => [r.id, r]));
    for (const sh of s.ships) {
      if (sh.mode !== 'mining') continue;
      const r = rocks.get(sh.targetId);
      if (!r) continue;
      push({ ...lerpPos(sh.id, sh.pos, a, tmp) }, r.pos, BEAM_COLORS.mine);
    }
    for (const f of s.fx) {
      const c = BEAM_COLORS[f.kind];
      if (c) push(f.a, f.b, c);
    }
    geo.setDrawRange(0, n * 2);
    pos.needsUpdate = true;
    col.needsUpdate = true;
  });
  return (
    <lineSegments geometry={geo} frustumCulled={false}>
      <lineBasicMaterial vertexColors toneMapped={false} transparent opacity={0.9} />
    </lineSegments>
  );
}

function Explosions() {
  const mesh = useRef<THREE.InstancedMesh>(null);
  useFrame(() => {
    const m = mesh.current;
    if (!m) return;
    let n = 0;
    for (const f of engine.state.fx) {
      if (f.kind !== 'explosion' && f.kind !== 'warp') continue;
      const life = f.kind === 'warp' ? 1.5 : 0.8;
      const k = 1 - f.ttl / life;
      dummy.position.set(f.a.x, f.a.y, f.a.z);
      dummy.scale.setScalar((f.kind === 'warp' ? 18 : 3) * Math.sin(k * Math.PI) + 0.01);
      dummy.updateMatrix();
      m.setMatrixAt(n++, dummy.matrix);
    }
    m.count = n;
    m.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, 128]} frustumCulled={false}>
      <icosahedronGeometry args={[1, 1]} />
      <meshBasicMaterial
        color={new THREE.Color('#ffaa55').multiplyScalar(3)}
        toneMapped={false}
        transparent
        opacity={0.8}
      />
    </instancedMesh>
  );
}

function Carrier() {
  const group = useRef<THREE.Group>(null);
  const shield = useRef<THREE.Mesh>(null);
  const warpRing = useRef<THREE.Mesh>(null);
  useFrame((st) => {
    const s = engine.state;
    const a = engine.alpha();
    const p = engine.prevCarrier;
    const c = s.carrier.pos;
    group.current?.position.set(
      p.x + (c.x - p.x) * a,
      p.y + (c.y - p.y) * a,
      p.z + (c.z - p.z) * a,
    );
    if (group.current && s.carrier.target) {
      const t = s.carrier.target;
      const ang = Math.atan2(t.x - c.x, t.z - c.z);
      group.current.rotation.y += (ang - group.current.rotation.y) * 0.01;
    }
    if (shield.current) {
      const mat = shield.current.material as THREE.MeshBasicMaterial;
      const threatened = s.pirates.length > 0;
      shield.current.visible = threatened && s.carrier.shield > 0;
      mat.opacity = s.carrier.shield * 0.07;
    }
    if (warpRing.current) {
      warpRing.current.visible = !!s.warp;
      warpRing.current.rotation.z = st.clock.elapsedTime * 2;
      const k = s.warp ? 1 + (1 - s.warp.charge / 15) * 2 : 1;
      warpRing.current.scale.setScalar(k);
    }
  });
  const hull = '#9aa7b8';
  return (
    <group ref={group}>
      <mesh>
        <boxGeometry args={[5, 2.6, 20]} />
        <meshStandardMaterial color={hull} metalness={0.6} roughness={0.4} flatShading />
      </mesh>
      <mesh position={[0, 1.2, 4]}>
        <boxGeometry args={[7.5, 1, 9]} />
        <meshStandardMaterial color="#7d8a9c" metalness={0.6} roughness={0.5} flatShading />
      </mesh>
      <mesh position={[0, 3, -5]}>
        <boxGeometry args={[1.8, 3, 3]} />
        <meshStandardMaterial color="#b9c3cf" metalness={0.5} roughness={0.4} flatShading />
      </mesh>
      {[-3.4, 3.4].map((x) => (
        <mesh key={x} position={[x, -0.4, 1]}>
          <boxGeometry args={[1.8, 2, 13]} />
          <meshStandardMaterial color="#6b7788" metalness={0.6} roughness={0.5} flatShading />
        </mesh>
      ))}
      {[-3.4, 3.4].map((x) => (
        <mesh key={'bay' + x} position={[x, -0.4, 7.6]}>
          <boxGeometry args={[1.2, 1.2, 0.2]} />
          <meshBasicMaterial
            color={new THREE.Color('#ffd27a').multiplyScalar(3)}
            toneMapped={false}
          />
        </mesh>
      ))}
      {[-1.4, 0, 1.4].map((x) => (
        <mesh key={'eng' + x} position={[x, 0, -10.3]}>
          <cylinderGeometry args={[0.6, 0.8, 0.6, 8]} />
          <meshBasicMaterial
            color={new THREE.Color('#58b8ff').multiplyScalar(5)}
            toneMapped={false}
          />
        </mesh>
      ))}
      <mesh ref={shield}>
        <sphereGeometry args={[14, 32, 16]} />
        <meshBasicMaterial
          color="#5ab4ff"
          transparent
          opacity={0.04}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
      <mesh ref={warpRing} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[12, 0.25, 8, 64]} />
        <meshBasicMaterial
          color={new THREE.Color('#9b7bff').multiplyScalar(4)}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}

function Hazards() {
  const s = useGame();
  return (
    <>
      {s.hazards.map((h, i) => (
        <group key={`${s.systemId}-${i}`} position={[h.pos.x, h.pos.y, h.pos.z]}>
          <mesh>
            <sphereGeometry args={[h.radius, 24, 16]} />
            <meshBasicMaterial
              color={h.kind === 'debris' ? '#ffb347' : '#b6ff4a'}
              transparent
              opacity={0.06}
              depthWrite={false}
            />
          </mesh>
          <mesh>
            <sphereGeometry args={[h.radius, 12, 8]} />
            <meshBasicMaterial
              color={h.kind === 'debris' ? '#ffb347' : '#b6ff4a'}
              wireframe
              transparent
              opacity={0.15}
            />
          </mesh>
        </group>
      ))}
    </>
  );
}

function GasGiant() {
  const s = useGame();
  const sys = s.systems[s.systemId];
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 } },
        vertexShader: GAS_VERT,
        fragmentShader: GAS_FRAG,
      }),
    [],
  );
  useFrame((st) => {
    mat.uniforms.uTime.value = st.clock.elapsedTime;
  });
  if (!sys.gasGiant) return null;
  const p = gasGiantPos(sys);
  return (
    <group position={[p.x, p.y, p.z]}>
      <mesh material={mat}>
        <sphereGeometry args={[25, 48, 32]} />
      </mesh>
      <mesh rotation={[Math.PI / 2.3, 0, 0]}>
        <ringGeometry args={[32, 44, 64]} />
        <meshBasicMaterial
          color="#d6b48a"
          transparent
          opacity={0.25}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

const TIER_SKY: Record<number, [string, string]> = {
  1: ['#2a6cff', '#7fd4ff'],
  2: ['#7a3cff', '#ff7bd0'],
  3: ['#ff3d2e', '#ffb35a'],
};

function Sky() {
  const s = useGame();
  const tier = s.systems[s.systemId].tier;
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uA: { value: new THREE.Color() }, uB: { value: new THREE.Color() } },
        vertexShader: NEBULA_VERT,
        fragmentShader: NEBULA_FRAG,
        side: THREE.BackSide,
        depthWrite: false,
      }),
    [],
  );
  useEffect(() => {
    mat.uniforms.uA.value.set(TIER_SKY[tier][0]);
    mat.uniforms.uB.value.set(TIER_SKY[tier][1]);
  }, [tier, mat]);
  const bright = s.systems[s.systemId].brightness;
  return (
    <>
      <mesh material={mat}>
        <sphereGeometry args={[900, 32, 16]} />
      </mesh>
      <Stars radius={500} depth={200} count={4000} factor={6} fade speed={0.3} />
      <mesh position={[400, 150, -500]}>
        <sphereGeometry args={[18 + bright * 10, 24, 16]} />
        <meshBasicMaterial
          color={new THREE.Color('#fff2c8').multiplyScalar(2 + bright * 2)}
          toneMapped={false}
        />
      </mesh>
      <directionalLight position={[400, 150, -500]} intensity={1.2 + bright} color="#fff1dc" />
      <ambientLight intensity={0.55} color="#8fa8ff" />
      <directionalLight position={[-200, 120, 300]} intensity={0.6} color="#9fb8ff" />
      <hemisphereLight args={['#6f8cff', '#1a0f20', 0.35]} />
    </>
  );
}

const ICON_COLORS: Record<string, THREE.Color> = {
  ...Object.fromEntries(
    SHIP_CLASSES.map((c) => [c, new THREE.Color(SHIP_STATS[c].color).multiplyScalar(1.6)]),
  ),
  pirate: new THREE.Color('#ff3030').multiplyScalar(2),
  carrier: new THREE.Color('#ffffff').multiplyScalar(2),
};

function Tactical({ on }: { on: boolean }) {
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(2048 * 3), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(2048 * 3), 3));
    return g;
  }, []);
  const ring = useRef<THREE.Group>(null);
  useFrame(() => {
    if (!on) return;
    const s = engine.state;
    const a = engine.alpha();
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const col = geo.getAttribute('color') as THREE.BufferAttribute;
    let n = 0;
    const put = (p: Vec3, c: THREE.Color) => {
      pos.setXYZ(n, p.x, p.y, p.z);
      col.setXYZ(n, c.r, c.g, c.b);
      n++;
    };
    put(s.carrier.pos, ICON_COLORS.carrier);
    for (const sh of s.ships)
      if (sh.mode !== 'docked' && n < 2048)
        put(lerpPos(sh.id, sh.pos, a, tmp), ICON_COLORS[sh.cls]);
    for (const p of s.pirates) if (n < 2048) put(lerpPos(p.id, p.pos, a, tmp), ICON_COLORS.pirate);
    geo.setDrawRange(0, n);
    pos.needsUpdate = true;
    col.needsUpdate = true;
    ring.current?.position.set(s.carrier.pos.x, s.carrier.pos.y, s.carrier.pos.z);
  });
  if (!on) return null;
  return (
    <>
      <points geometry={geo} frustumCulled={false}>
        <pointsMaterial size={7} sizeAttenuation={false} vertexColors toneMapped={false} />
      </points>
      <group ref={ring}>
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[COVER_RADIUS - 0.4, COVER_RADIUS, 96]} />
          <meshBasicMaterial color="#5ab4ff" transparent opacity={0.5} side={THREE.DoubleSide} />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[44.6, 45, 96]} />
          <meshBasicMaterial color="#5ab4ff" transparent opacity={0.2} side={THREE.DoubleSide} />
        </mesh>
      </group>
      <gridHelper args={[400, 40, '#1d3a5c', '#10243a']} position={[0, -12, 0]} />
    </>
  );
}

function CameraRig({
  tactical,
  onAutoTactical,
}: {
  tactical: boolean;
  onAutoTactical: (on: boolean) => void;
}) {
  const controls = useRef<OrbitControlsImpl>(null);
  const { camera } = useThree();
  const last = useRef(new THREE.Vector3());
  const autoOn = useRef(false);
  const wasTactical = useRef(tactical);
  useFrame(() => {
    const c = controls.current;
    if (!c) return;
    const s = engine.state;
    const a = engine.alpha();
    const p = engine.prevCarrier;
    const cur = s.carrier.pos;
    tmpV.set(p.x + (cur.x - p.x) * a, p.y + (cur.y - p.y) * a, p.z + (cur.z - p.z) * a);
    const delta = tmpV.clone().sub(last.current);
    if (delta.lengthSq() < 400) {
      c.target.add(delta);
      camera.position.add(delta);
    } else {
      c.target.copy(tmpV);
    }
    last.current.copy(tmpV);
    if (tactical && !wasTactical.current) {
      camera.position.set(c.target.x, c.target.y + 230, c.target.z + 1);
    } else if (!tactical && wasTactical.current && !autoOn.current) {
      camera.position.set(c.target.x + 40, c.target.y + 28, c.target.z + 55);
    }
    wasTactical.current = tactical;
    const d = camera.position.distanceTo(c.target);
    const shouldAuto = d > 190;
    if (shouldAuto !== autoOn.current) {
      autoOn.current = shouldAuto;
      onAutoTactical(shouldAuto);
    }
    c.update();
  });
  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.08}
      minDistance={8}
      maxDistance={360}
    />
  );
}

export function Scene({ tactical, quality, onAutoTactical }: ViewOptions) {
  const [auto, setAuto] = useState(false);
  const onAuto = (on: boolean) => {
    setAuto(on);
    onAutoTactical(on);
  };
  return (
    <Canvas
      camera={{ position: [40, 28, 55], fov: 55, near: 0.5, far: 3000 }}
      dpr={quality === 'high' ? [1, 2] : 1}
      gl={{ antialias: quality === 'high', powerPreference: 'high-performance' }}
      frameloop="always"
    >
      <color attach="background" args={['#020308']} />
      <Sky />
      <GasGiant />
      <Asteroids />
      <Hazards />
      <Carrier />
      {[...SHIP_CLASSES, 'pirate' as const].map((c) => (
        <ShipLayer key={c} cls={c} />
      ))}
      <Beams />
      <Explosions />
      <Tactical on={tactical || auto} />
      <CameraRig tactical={tactical} onAutoTactical={onAuto} />
      {quality === 'high' && (
        <EffectComposer multisampling={0}>
          <Bloom mipmapBlur intensity={1.1} luminanceThreshold={1} luminanceSmoothing={0.2} />
          <Vignette eskil={false} offset={0.2} darkness={0.7} />
        </EffectComposer>
      )}
    </Canvas>
  );
}
