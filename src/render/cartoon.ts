import * as THREE from 'three';
import { backboneTraces } from '../core/bonds';
import type { SecondaryStructure, Structure } from '../core/types';

/** Cross-section half-extents per secondary structure, in angstrom. */
const PROFILES: Record<SecondaryStructure, { width: number; thickness: number }> = {
  helix: { width: 0.95, thickness: 0.28 },
  sheet: { width: 1.05, thickness: 0.22 },
  coil: { width: 0.28, thickness: 0.28 },
};

const SS_COLORS: Record<SecondaryStructure, number> = {
  helix: 0xff4f6d,
  sheet: 0xffc857,
  coil: 0x6fe3d0,
};

const CHAIN_COLORS = [
  0x4f9cff, 0xff7b4f, 0x64d97b, 0xc77bff, 0xffd24f, 0x4fe3d9, 0xff6fae, 0x9ad04f,
];

const SAMPLES_PER_RESIDUE = 6;
const CROSS_SECTION_SIDES = 8;

export type CartoonColoring = 'secondaryStructure' | 'chain';

/**
 * Builds a cartoon ribbon: a spline through the backbone anchors, swept with an
 * elliptical cross-section whose width follows secondary structure (flat ribbon
 * through helices and strands, thin tube through coils).
 *
 * The mesh is generated once on the CPU and never per frame — this is the
 * expensive step that a mobile client would offload to a worker or cache.
 */
export function buildCartoon(
  structure: Structure,
  coloring: CartoonColoring = 'secondaryStructure',
): THREE.Mesh | null {
  const traces = backboneTraces(structure);
  if (traces.length === 0) return null;

  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  for (const trace of traces) {
    const points = trace.map((i) => {
      const atom = structure.atoms[i];
      return new THREE.Vector3(atom.x, atom.y, atom.z);
    });
    if (points.length < 2) continue;

    const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal', 0.5);
    const sampleCount = Math.max(points.length * SAMPLES_PER_RESIDUE, 8);
    const frames = curve.computeFrenetFrames(sampleCount, false);
    const ringStart = positions.length / 3;
    const chainIndex = structure.residues[structure.atoms[trace[0]].residueIndex].chainIndex;

    for (let s = 0; s <= sampleCount; s++) {
      const t = s / sampleCount;
      const center = curve.getPointAt(t);
      const frameIndex = Math.min(s, frames.normals.length - 1);
      const normal = frames.normals[frameIndex];
      const binormal = frames.binormals[frameIndex];

      // Interpolate the profile so helix-to-coil transitions taper instead of
      // stepping, which is what makes the ribbon read as continuous.
      const residueIndex = residueAt(structure, trace, t);
      const ss = structure.residues[residueIndex].secondaryStructure;
      const profile = PROFILES[ss];
      const color = new THREE.Color(
        coloring === 'chain'
          ? CHAIN_COLORS[chainIndex % CHAIN_COLORS.length]
          : SS_COLORS[ss],
      );

      for (let k = 0; k < CROSS_SECTION_SIDES; k++) {
        const angle = (k / CROSS_SECTION_SIDES) * Math.PI * 2;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const offset = new THREE.Vector3()
          .addScaledVector(normal, cos * profile.width)
          .addScaledVector(binormal, sin * profile.thickness);
        positions.push(center.x + offset.x, center.y + offset.y, center.z + offset.z);
        const n = offset.clone().normalize();
        normals.push(n.x, n.y, n.z);
        colors.push(color.r, color.g, color.b);
      }
    }

    for (let s = 0; s < sampleCount; s++) {
      for (let k = 0; k < CROSS_SECTION_SIDES; k++) {
        const next = (k + 1) % CROSS_SECTION_SIDES;
        const a = ringStart + s * CROSS_SECTION_SIDES + k;
        const b = ringStart + s * CROSS_SECTION_SIDES + next;
        const c = ringStart + (s + 1) * CROSS_SECTION_SIDES + next;
        const d = ringStart + (s + 1) * CROSS_SECTION_SIDES + k;
        indices.push(a, b, c, a, c, d);
      }
    }
  }

  if (positions.length === 0) return null;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.55,
    metalness: 0.05,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  return mesh;
}

function residueAt(structure: Structure, trace: readonly number[], t: number): number {
  const position = Math.min(trace.length - 1, Math.round(t * (trace.length - 1)));
  return structure.atoms[trace[position]].residueIndex;
}

/** Thin backbone tube used as the far-distance LOD for the cartoon. */
export function buildBackboneTube(structure: Structure): THREE.Mesh | null {
  const traces = backboneTraces(structure);
  if (traces.length === 0) return null;

  const geometries: THREE.BufferGeometry[] = [];
  for (const trace of traces) {
    const points = trace.map((i) => {
      const atom = structure.atoms[i];
      return new THREE.Vector3(atom.x, atom.y, atom.z);
    });
    if (points.length < 2) continue;
    const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal', 0.5);
    geometries.push(new THREE.TubeGeometry(curve, points.length * 2, 0.35, 5, false));
  }
  if (geometries.length === 0) return null;

  const merged = mergeGeometries(geometries);
  for (const geometry of geometries) geometry.dispose();
  const material = new THREE.MeshStandardMaterial({
    color: 0x8fb4ff,
    roughness: 0.6,
    metalness: 0.05,
  });
  const mesh = new THREE.Mesh(merged, material);
  mesh.frustumCulled = false;
  return mesh;
}

/**
 * Minimal position/normal/index merge. Avoids pulling in the BufferGeometryUtils
 * addon for a single call and keeps the attribute set explicit.
 */
function mergeGeometries(geometries: readonly THREE.BufferGeometry[]): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  let offset = 0;

  for (const geometry of geometries) {
    const position = geometry.getAttribute('position');
    const normal = geometry.getAttribute('normal');
    const index = geometry.getIndex();
    for (let i = 0; i < position.count; i++) {
      positions.push(position.getX(i), position.getY(i), position.getZ(i));
      normals.push(normal.getX(i), normal.getY(i), normal.getZ(i));
    }
    if (index) {
      for (let i = 0; i < index.count; i++) indices.push(index.getX(i) + offset);
    }
    offset += position.count;
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  merged.setIndex(indices);
  merged.computeBoundingSphere();
  return merged;
}
