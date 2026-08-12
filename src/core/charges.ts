/**
 * Coarse partial charges for the electrostatic term. These are residue/atom-name
 * lookups covering the ionizable groups and backbone polar atoms, not a real
 * force field: the scorer reports a relative interaction score, so only the sign
 * and rough magnitude of charge-charge terms need to be right.
 */
const SIDE_CHAIN_CHARGES: Record<string, Record<string, number>> = {
  ASP: { OD1: -0.5, OD2: -0.5, CG: 0.2 },
  GLU: { OE1: -0.5, OE2: -0.5, CD: 0.2 },
  LYS: { NZ: 1.0 },
  ARG: { NE: 0.3, NH1: 0.35, NH2: 0.35, CZ: 0.2 },
  HIS: { ND1: 0.15, NE2: 0.15 },
  SER: { OG: -0.35 },
  THR: { OG1: -0.35 },
  TYR: { OH: -0.35 },
  CYS: { SG: -0.2 },
  ASN: { OD1: -0.35, ND2: 0.2 },
  GLN: { OE1: -0.35, NE2: 0.2 },
  TRP: { NE1: 0.15 },
};

const BACKBONE_CHARGES: Record<string, number> = {
  N: -0.3,
  H: 0.3,
  CA: 0.05,
  C: 0.4,
  O: -0.4,
  OXT: -0.5,
};

/** Phosphate backbone of nucleic acids carries the dominant charge. */
const NUCLEIC_CHARGES: Record<string, number> = {
  P: 0.9,
  OP1: -0.7,
  OP2: -0.7,
  "O1P": -0.7,
  "O2P": -0.7,
};

export function partialCharge(residueName: string, atomName: string): number {
  const residue = residueName.toUpperCase();
  const atom = atomName.toUpperCase();

  const nucleic = NUCLEIC_CHARGES[atom];
  if (nucleic !== undefined) return nucleic;

  const sideChain = SIDE_CHAIN_CHARGES[residue]?.[atom];
  if (sideChain !== undefined) return sideChain;

  const backbone = BACKBONE_CHARGES[atom];
  if (backbone !== undefined) return backbone;

  return 0;
}

const NONPOLAR_ELEMENTS = new Set(['C', 'S']);

export function isNonpolar(element: string): boolean {
  return NONPOLAR_ELEMENTS.has(element.toUpperCase());
}
