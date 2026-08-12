export type Vec3 = readonly [number, number, number];

export type SecondaryStructure = 'helix' | 'sheet' | 'coil';

export interface Atom {
  /** Zero-based index into the parent structure's flat atom array. */
  index: number;
  serial: number;
  /** Atom name as authored, e.g. "CA", "OD1". */
  name: string;
  element: string;
  altLoc: string;
  x: number;
  y: number;
  z: number;
  occupancy: number;
  bFactor: number;
  /** True for HETATM records / non-polymer chemical components. */
  hetero: boolean;
  residueIndex: number;
}

export interface Residue {
  index: number;
  /** Chemical component id, e.g. "ALA", "HOH", "ATP". */
  name: string;
  /** Author-assigned sequence number. */
  seq: number;
  insertionCode: string;
  chainIndex: number;
  atomIndices: number[];
  secondaryStructure: SecondaryStructure;
  hetero: boolean;
}

export interface Chain {
  index: number;
  id: string;
  residueIndices: number[];
}

export interface Structure {
  id: string;
  title: string;
  atoms: Atom[];
  residues: Residue[];
  chains: Chain[];
}

export interface Bond {
  a: number;
  b: number;
}

const AMINO_ACIDS = new Set([
  'ALA', 'ARG', 'ASN', 'ASP', 'CYS', 'GLN', 'GLU', 'GLY', 'HIS', 'ILE',
  'LEU', 'LYS', 'MET', 'PHE', 'PRO', 'SER', 'THR', 'TRP', 'TYR', 'VAL',
  'MSE', 'SEC', 'PYL', 'ASX', 'GLX', 'UNK',
]);

const NUCLEOTIDES = new Set([
  'A', 'C', 'G', 'T', 'U', 'DA', 'DC', 'DG', 'DT', 'DU', 'N',
]);

const SOLVENT = new Set(['HOH', 'DOD', 'WAT', 'H2O']);

export function isAminoAcid(residueName: string): boolean {
  return AMINO_ACIDS.has(residueName.toUpperCase());
}

export function isNucleotide(residueName: string): boolean {
  return NUCLEOTIDES.has(residueName.toUpperCase());
}

export function isSolvent(residueName: string): boolean {
  return SOLVENT.has(residueName.toUpperCase());
}

export function isPolymer(residueName: string): boolean {
  return isAminoAcid(residueName) || isNucleotide(residueName);
}

export function atomPosition(atom: Atom): Vec3 {
  return [atom.x, atom.y, atom.z];
}

export function residueAtom(
  structure: Structure,
  residue: Residue,
  name: string,
): Atom | undefined {
  for (const i of residue.atomIndices) {
    if (structure.atoms[i].name === name) return structure.atoms[i];
  }
  return undefined;
}

export interface BoundingSphere {
  center: Vec3;
  radius: number;
}

export function boundingSphere(atoms: readonly Atom[]): BoundingSphere {
  if (atoms.length === 0) return { center: [0, 0, 0], radius: 0 };
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (const a of atoms) {
    cx += a.x;
    cy += a.y;
    cz += a.z;
  }
  cx /= atoms.length;
  cy /= atoms.length;
  cz /= atoms.length;
  let r2 = 0;
  for (const a of atoms) {
    const d = (a.x - cx) ** 2 + (a.y - cy) ** 2 + (a.z - cz) ** 2;
    if (d > r2) r2 = d;
  }
  return { center: [cx, cy, cz], radius: Math.sqrt(r2) };
}

export function structureStats(structure: Structure): {
  atoms: number;
  residues: number;
  chains: number;
  polymerResidues: number;
  heteroAtoms: number;
} {
  let polymerResidues = 0;
  for (const r of structure.residues) if (!r.hetero) polymerResidues++;
  let heteroAtoms = 0;
  for (const a of structure.atoms) if (a.hetero) heteroAtoms++;
  return {
    atoms: structure.atoms.length,
    residues: structure.residues.length,
    chains: structure.chains.length,
    polymerResidues,
    heteroAtoms,
  };
}
