import type { Atom } from './types';

/**
 * Uniform spatial hash over atom positions. Bond inference and the interaction
 * scorer are both O(n) neighbourhood queries; a naive O(n^2) pass over a
 * 100k-atom structure would take minutes on a phone.
 */
export class NeighborGrid {
  private readonly cellSize: number;
  private readonly cells = new Map<number, number[]>();
  private readonly minX: number;
  private readonly minY: number;
  private readonly minZ: number;
  private readonly nx: number;
  private readonly ny: number;
  private readonly nz: number;

  constructor(
    private readonly atoms: readonly Atom[],
    cellSize: number,
  ) {
    this.cellSize = Math.max(cellSize, 0.5);

    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    for (const a of atoms) {
      if (a.x < minX) minX = a.x;
      if (a.y < minY) minY = a.y;
      if (a.z < minZ) minZ = a.z;
      if (a.x > maxX) maxX = a.x;
      if (a.y > maxY) maxY = a.y;
      if (a.z > maxZ) maxZ = a.z;
    }
    if (atoms.length === 0) {
      minX = minY = minZ = 0;
      maxX = maxY = maxZ = 0;
    }
    this.minX = minX;
    this.minY = minY;
    this.minZ = minZ;
    this.nx = Math.max(1, Math.floor((maxX - minX) / this.cellSize) + 1);
    this.ny = Math.max(1, Math.floor((maxY - minY) / this.cellSize) + 1);
    this.nz = Math.max(1, Math.floor((maxZ - minZ) / this.cellSize) + 1);

    for (let i = 0; i < atoms.length; i++) {
      const a = atoms[i];
      const key = this.key(
        Math.floor((a.x - minX) / this.cellSize),
        Math.floor((a.y - minY) / this.cellSize),
        Math.floor((a.z - minZ) / this.cellSize),
      );
      const bucket = this.cells.get(key);
      if (bucket) bucket.push(i);
      else this.cells.set(key, [i]);
    }
  }

  /**
   * Cell indices are bounds-checked before hashing: without that, a negative or
   * overflowing index folds onto a different row and the same bucket is visited
   * more than once, which silently double-counts every neighbour.
   */
  private key(ix: number, iy: number, iz: number): number {
    return (iz * this.ny + iy) * this.nx + ix;
  }

  private inBounds(ix: number, iy: number, iz: number): boolean {
    return (
      ix >= 0 && ix < this.nx && iy >= 0 && iy < this.ny && iz >= 0 && iz < this.nz
    );
  }

  /** Calls `visit` for every atom index within `radius` of the given point. */
  forEachWithin(
    x: number,
    y: number,
    z: number,
    radius: number,
    visit: (atomIndex: number, distanceSquared: number) => void,
  ): void {
    const r2 = radius * radius;
    const span = Math.ceil(radius / this.cellSize);
    const ix = Math.floor((x - this.minX) / this.cellSize);
    const iy = Math.floor((y - this.minY) / this.cellSize);
    const iz = Math.floor((z - this.minZ) / this.cellSize);

    for (let dz = -span; dz <= span; dz++) {
      for (let dy = -span; dy <= span; dy++) {
        for (let dx = -span; dx <= span; dx++) {
          const cx = ix + dx;
          const cy = iy + dy;
          const cz = iz + dz;
          if (!this.inBounds(cx, cy, cz)) continue;
          const bucket = this.cells.get(this.key(cx, cy, cz));
          if (!bucket) continue;
          for (const index of bucket) {
            const a = this.atoms[index];
            const d2 = (a.x - x) ** 2 + (a.y - y) ** 2 + (a.z - z) ** 2;
            if (d2 <= r2) visit(index, d2);
          }
        }
      }
    }
  }
}
