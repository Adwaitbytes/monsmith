"use client";

import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useReducedMotion } from "framer-motion";

/**
 * The hero's ambient WebGL layer: glowing particles stream left-to-right through
 * several parallel lanes, with a few faint cross-links standing in for state
 * dependencies. It is the execution model rendered as depth and motion, not a
 * generic particle field. Kept deliberately small (a few hundred points, capped
 * DPR, transparent canvas) and fully frozen under reduced-motion.
 */

const LANES = 7;
const PER_LANE = 24;
const COUNT = LANES * PER_LANE;
const SPAN = 10; // lane length on X
const Y_SPREAD = 3.2; // vertical spread of lanes

/** Deterministic PRNG so the field is stable across renders and hydration. */
function makeRand(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function glowTexture() {
  const size = 64;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grd.addColorStop(0, "rgba(255,255,255,1)");
  grd.addColorStop(0.3, "rgba(196,176,246,0.85)");
  grd.addColorStop(1, "rgba(124,58,237,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.needsUpdate = true;
  return t;
}

type P = { lane: number; y: number; z: number; speed: number; size: number; bright: number };

function Field({ reduce, dark }: { reduce: boolean; dark: boolean }) {
  const group = useRef<THREE.Group>(null);
  const points = useRef<THREE.Points>(null);
  const pointer = useRef({ x: 0, y: 0 });
  const tex = useMemo(() => glowTexture(), []);

  const { positions, colors, sizes, meta, laneLines, depLines } = useMemo(() => {
    const positions = new Float32Array(COUNT * 3);
    const colors = new Float32Array(COUNT * 3);
    const sizes = new Float32Array(COUNT);
    const meta: P[] = [];
    const violet = new THREE.Color("#8b5cf6");
    const white = new THREE.Color("#efe9ff");
    const rand = makeRand(0x5eed);

    for (let lane = 0; lane < LANES; lane++) {
      const y = (lane / (LANES - 1) - 0.5) * Y_SPREAD;
      const z = Math.sin(lane * 1.7) * 1.1;
      for (let j = 0; j < PER_LANE; j++) {
        const i = lane * PER_LANE + j;
        const bright = rand();
        const x = (j / PER_LANE) * SPAN - SPAN / 2 + rand() * 0.2;
        positions[i * 3] = x;
        positions[i * 3 + 1] = y + (rand() - 0.5) * 0.12;
        positions[i * 3 + 2] = z;
        const col = white.clone().lerp(violet, 0.35 + rand() * 0.55);
        colors[i * 3] = col.r;
        colors[i * 3 + 1] = col.g;
        colors[i * 3 + 2] = col.b;
        const size = 0.06 + bright * 0.16;
        sizes[i] = size;
        meta.push({ lane, y, z, speed: 0.5 + rand() * 0.9, size, bright });
      }
    }

    // Faint lane guides
    const laneLines: number[] = [];
    for (let lane = 0; lane < LANES; lane++) {
      const y = (lane / (LANES - 1) - 0.5) * Y_SPREAD;
      const z = Math.sin(lane * 1.7) * 1.1;
      laneLines.push(-SPAN / 2, y, z, SPAN / 2, y, z);
    }

    // A few dependency cross-links between neighbouring lanes
    const depLines: number[] = [];
    const pairs = [
      [0, 1],
      [2, 3],
      [4, 5],
      [3, 6],
    ];
    for (const [a, b] of pairs) {
      const ya = (a / (LANES - 1) - 0.5) * Y_SPREAD;
      const yb = (b / (LANES - 1) - 0.5) * Y_SPREAD;
      const za = Math.sin(a * 1.7) * 1.1;
      const zb = Math.sin(b * 1.7) * 1.1;
      const x = (rand() - 0.5) * SPAN * 0.5;
      depLines.push(x, ya, za, x + 0.6, yb, zb);
    }

    return { positions, colors, sizes, meta, laneLines: new Float32Array(laneLines), depLines: new Float32Array(depLines) };
  }, []);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      pointer.current.x = (e.clientX / window.innerWidth) * 2 - 1;
      pointer.current.y = (e.clientY / window.innerHeight) * 2 - 1;
    };
    window.addEventListener("pointermove", onMove);
    return () => window.removeEventListener("pointermove", onMove);
  }, []);

  useFrame((_, delta) => {
    const g = group.current;
    if (g) {
      // base tilt + eased parallax toward the pointer
      const targetY = 0.32 + pointer.current.x * 0.18;
      const targetX = -0.14 - pointer.current.y * 0.1;
      g.rotation.y += (targetY - g.rotation.y) * Math.min(1, delta * 2.5);
      g.rotation.x += (targetX - g.rotation.x) * Math.min(1, delta * 2.5);
    }
    if (reduce) return;
    const geo = points.current?.geometry;
    if (!geo) return;
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const d = Math.min(delta, 0.05);
    for (let i = 0; i < COUNT; i++) {
      let x = pos.getX(i) + meta[i].speed * d;
      if (x > SPAN / 2) x = -SPAN / 2;
      pos.setX(i, x);
    }
    pos.needsUpdate = true;
  });

  return (
    <group ref={group} rotation={[-0.14, 0.32, 0]}>
      <points ref={points}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[positions, 3]} />
          <bufferAttribute attach="attributes-color" args={[colors, 3]} />
          <bufferAttribute attach="attributes-size" args={[sizes, 1]} />
        </bufferGeometry>
        <pointsMaterial
          map={tex}
          size={0.34}
          sizeAttenuation
          vertexColors
          transparent
          depthWrite={false}
          blending={dark ? THREE.AdditiveBlending : THREE.NormalBlending}
          opacity={dark ? 0.9 : 0.7}
        />
      </points>

      <lineSegments>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[laneLines, 3]} />
        </bufferGeometry>
        <lineBasicMaterial color="#7c3aed" transparent opacity={dark ? 0.12 : 0.18} />
      </lineSegments>

      <lineSegments>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[depLines, 3]} />
        </bufferGeometry>
        <lineBasicMaterial color="#a78bfa" transparent opacity={0.35} />
      </lineSegments>
    </group>
  );
}

function Rig() {
  const { camera } = useThree();
  useEffect(() => {
    camera.position.set(0, 0, 7.5);
  }, [camera]);
  return null;
}

export default function HeroScene({ dark = true }: { dark?: boolean }) {
  const reduce = !!useReducedMotion();
  return (
    <Canvas
      className="!absolute inset-0"
      style={{ pointerEvents: "none" }}
      dpr={[1, 1.75]}
      frameloop={reduce ? "demand" : "always"}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      camera={{ fov: 50, position: [0, 0, 7.5] }}
    >
      <Rig />
      <Field reduce={reduce} dark={dark} />
    </Canvas>
  );
}
