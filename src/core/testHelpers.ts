import { StructureBuilder, type RawAtom } from './builder';
import type { Structure } from './types';

export interface SyntheticAtom {
  name: string;
  element: string;
  x: number;
  y: number;
  z: number;
  residueName?: string;
  residueSeq?: number;
  chainId?: string;
  hetero?: boolean;
}

/** Assembles a Structure directly from coordinates, bypassing file parsing. */
export function buildStructure(atoms: readonly SyntheticAtom[], id = 'TEST'): Structure {
  const builder = new StructureBuilder(id, 'synthetic');
  atoms.forEach((atom, index) => {
    const raw: RawAtom = {
      serial: index + 1,
      name: atom.name,
      element: atom.element,
      altLoc: '',
      x: atom.x,
      y: atom.y,
      z: atom.z,
      occupancy: 1,
      bFactor: 0,
      hetero: atom.hetero ?? false,
      chainId: atom.chainId ?? 'A',
      residueName: atom.residueName ?? 'ALA',
      residueSeq: atom.residueSeq ?? index + 1,
      insertionCode: '',
    };
    builder.add(raw);
  });
  return builder.build();
}

/**
 * Ideal right-handed alpha helix CA trace: 1.5 A rise and 100 degrees of
 * rotation per residue on a 2.3 A radius. Gives the geometric secondary
 * structure assignment a case with a known answer.
 */
export function idealHelixTrace(residues: number, chainId = 'A'): SyntheticAtom[] {
  const radius = 2.3;
  const rise = 1.5;
  const twist = (100 * Math.PI) / 180;
  return Array.from({ length: residues }, (_, i) => ({
    name: 'CA',
    element: 'C',
    x: radius * Math.cos(i * twist),
    y: radius * Math.sin(i * twist),
    z: i * rise,
    residueName: 'ALA',
    residueSeq: i + 1,
    chainId,
  }));
}

/** Extended beta strand CA trace: 3.3 A rise with a 180 degree zig-zag. */
export function idealStrandTrace(residues: number, chainId = 'B'): SyntheticAtom[] {
  return Array.from({ length: residues }, (_, i) => ({
    name: 'CA',
    element: 'C',
    x: i % 2 === 0 ? 0.9 : -0.9,
    y: 0,
    z: i * 3.3,
    residueName: 'VAL',
    residueSeq: i + 1,
    chainId,
  }));
}
