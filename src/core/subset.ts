import type { Atom, Chain, Residue, Structure } from './types';

/**
 * Extracts a self-contained Structure from a set of atom indices, re-indexing
 * atoms, residues, and chains. Needed because the docking sandbox renders each
 * partner independently so one can be transformed without touching the other.
 */
export function subStructure(
  structure: Structure,
  atomIndices: readonly number[],
  id = structure.id,
): Structure {
  const keep = new Set(atomIndices);
  const atoms: Atom[] = [];
  const residues: Residue[] = [];
  const chains: Chain[] = [];
  const residueMap = new Map<number, number>();
  const chainMap = new Map<number, number>();

  for (const oldIndex of [...keep].sort((a, b) => a - b)) {
    const oldAtom = structure.atoms[oldIndex];
    if (!oldAtom) continue;
    const oldResidue = structure.residues[oldAtom.residueIndex];

    let chainIndex = chainMap.get(oldResidue.chainIndex);
    if (chainIndex === undefined) {
      chainIndex = chains.length;
      chains.push({
        index: chainIndex,
        id: structure.chains[oldResidue.chainIndex].id,
        residueIndices: [],
      });
      chainMap.set(oldResidue.chainIndex, chainIndex);
    }

    let residueIndex = residueMap.get(oldAtom.residueIndex);
    if (residueIndex === undefined) {
      residueIndex = residues.length;
      residues.push({ ...oldResidue, index: residueIndex, chainIndex, atomIndices: [] });
      residueMap.set(oldAtom.residueIndex, residueIndex);
      chains[chainIndex].residueIndices.push(residueIndex);
    }

    const atom: Atom = { ...oldAtom, index: atoms.length, residueIndex };
    atoms.push(atom);
    residues[residueIndex].atomIndices.push(atom.index);
  }

  return { id, title: structure.title, atoms, residues, chains };
}

export function centroid(structure: Structure): [number, number, number] {
  if (structure.atoms.length === 0) return [0, 0, 0];
  let x = 0;
  let y = 0;
  let z = 0;
  for (const atom of structure.atoms) {
    x += atom.x;
    y += atom.y;
    z += atom.z;
  }
  const n = structure.atoms.length;
  return [x / n, y / n, z / n];
}
