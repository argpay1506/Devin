import { vdwRadius } from './elements';
import { NeighborGrid } from './grid';
import type { Atom } from './types';

/** Radius of the water probe rolled over the surface, in angstrom. */
export const PROBE_RADIUS = 1.4;

/**
 * Golden-spiral points on the unit sphere. Shrake-Rupley numerically integrates
 * accessibility by testing sample points, so an even distribution matters more
 * than the exact count; 92 points keeps per-atom error near 1 A^2.
 */
function spherePoints(count: number): Float32Array {
  const points = new Float32Array(count * 3);
  const offset = 2 / count;
  const increment = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i++) {
    const y = i * offset - 1 + offset / 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const phi = i * increment;
    points[i * 3] = Math.cos(phi) * r;
    points[i * 3 + 1] = y;
    points[i * 3 + 2] = Math.sin(phi) * r;
  }
  return points;
}

const SPHERE_POINTS = spherePoints(92);

/**
 * Solvent-accessible surface area per atom (Shrake-Rupley), in A^2.
 * `subset` restricts which atoms are measured; occlusion is always computed
 * against every atom passed in, so an interface-only subset stays correct.
 */
export function solventAccessibleArea(
  atoms: readonly Atom[],
  subset?: readonly number[],
): Map<number, number> {
  const radii = atoms.map((a) => vdwRadius(a.element) + PROBE_RADIUS);
  let maxRadius = 0;
  for (const r of radii) if (r > maxRadius) maxRadius = r;
  const grid = new NeighborGrid(atoms, Math.max(2 * maxRadius, 1));
  const indices = subset ?? atoms.map((_, i) => i);
  const result = new Map<number, number>();
  const pointCount = SPHERE_POINTS.length / 3;

  for (const i of indices) {
    const a = atoms[i];
    const ri = radii[i];
    const neighbors: number[] = [];
    grid.forEachWithin(a.x, a.y, a.z, ri + maxRadius, (j) => {
      if (j !== i) neighbors.push(j);
    });

    let accessible = 0;
    for (let p = 0; p < pointCount; p++) {
      const px = a.x + SPHERE_POINTS[p * 3] * ri;
      const py = a.y + SPHERE_POINTS[p * 3 + 1] * ri;
      const pz = a.z + SPHERE_POINTS[p * 3 + 2] * ri;
      let occluded = false;
      for (const j of neighbors) {
        const b = atoms[j];
        const rj = radii[j];
        const d2 = (b.x - px) ** 2 + (b.y - py) ** 2 + (b.z - pz) ** 2;
        if (d2 < rj * rj) {
          occluded = true;
          break;
        }
      }
      if (!occluded) accessible++;
    }
    result.set(i, 4 * Math.PI * ri * ri * (accessible / pointCount));
  }
  return result;
}

export function totalArea(areas: Map<number, number>): number {
  let sum = 0;
  for (const value of areas.values()) sum += value;
  return sum;
}
