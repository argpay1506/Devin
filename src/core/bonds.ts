import { covalentRadius } from './elements';
import { NeighborGrid } from './grid';
import type { Bond, Structure } from './types';

const BOND_TOLERANCE = 0.45;
const MAX_BOND_LENGTH = 2.2;
/** Below this, two atoms are the same site duplicated, not bonded. */
const MIN_BOND_LENGTH = 0.4;

/**
 * Infers covalent bonds from interatomic distances against summed covalent
 * radii. Distance geometry is used rather than a chemical component dictionary
 * because the viewer must handle arbitrary ligands and modified residues
 * without shipping the full CCD.
 */
export function inferBonds(structure: Structure): Bond[] {
  const atoms = structure.atoms;
  const grid = new NeighborGrid(atoms, MAX_BOND_LENGTH);
  const radii = atoms.map((a) => covalentRadius(a.element));
  const bonds: Bond[] = [];

  for (let i = 0; i < atoms.length; i++) {
    const a = atoms[i];
    grid.forEachWithin(a.x, a.y, a.z, MAX_BOND_LENGTH, (j, d2) => {
      if (j <= i) return;
      if (d2 < MIN_BOND_LENGTH * MIN_BOND_LENGTH) return;
      // Hydrogen never bonds to hydrogen; skipping avoids spurious H-H sticks
      // in structures with explicit hydrogens.
      if (a.element === 'H' && atoms[j].element === 'H') return;
      const cutoff = radii[i] + radii[j] + BOND_TOLERANCE;
      if (d2 <= cutoff * cutoff) bonds.push({ a: i, b: j });
    });
  }
  return bonds;
}

/**
 * Backbone trace per chain: the ordered CA (protein) or P (nucleic) atom
 * indices, split wherever the chain has a gap so cartoon ribbons do not shoot
 * across a disordered loop.
 */
export function backboneTraces(structure: Structure): number[][] {
  const MAX_CA_GAP = 5.0;
  const traces: number[][] = [];

  for (const chain of structure.chains) {
    let current: number[] = [];
    let previous: { x: number; y: number; z: number } | null = null;

    for (const residueIndex of chain.residueIndices) {
      const residue = structure.residues[residueIndex];
      if (residue.hetero) continue;
      let anchor = -1;
      for (const atomIndex of residue.atomIndices) {
        const name = structure.atoms[atomIndex].name;
        if (name === 'CA' || name === 'P') {
          anchor = atomIndex;
          break;
        }
      }
      if (anchor === -1) continue;
      const atom = structure.atoms[anchor];
      if (previous) {
        const d = Math.hypot(atom.x - previous.x, atom.y - previous.y, atom.z - previous.z);
        if (d > MAX_CA_GAP) {
          if (current.length > 1) traces.push(current);
          current = [];
        }
      }
      current.push(anchor);
      previous = atom;
    }
    if (current.length > 1) traces.push(current);
  }
  return traces;
}
