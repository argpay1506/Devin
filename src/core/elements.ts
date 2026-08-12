/** Bondi van der Waals radii in angstrom, with common-element fallbacks. */
const VDW_RADII: Record<string, number> = {
  H: 1.2, HE: 1.4, LI: 1.82, BE: 1.53, B: 1.92, C: 1.7, N: 1.55, O: 1.52,
  F: 1.47, NE: 1.54, NA: 2.27, MG: 1.73, AL: 1.84, SI: 2.1, P: 1.8, S: 1.8,
  CL: 1.75, AR: 1.88, K: 2.75, CA: 2.31, FE: 2.0, MN: 2.05, CO: 2.0, NI: 1.63,
  CU: 1.4, ZN: 1.39, SE: 1.9, BR: 1.85, I: 1.98, MO: 2.1, CD: 1.58, HG: 1.55,
};

/** Covalent radii in angstrom, used for bond inference. */
const COVALENT_RADII: Record<string, number> = {
  H: 0.31, C: 0.76, N: 0.71, O: 0.66, F: 0.57, NA: 1.66, MG: 1.41, P: 1.07,
  S: 1.05, CL: 1.02, K: 2.03, CA: 1.76, FE: 1.32, MN: 1.39, CO: 1.26,
  NI: 1.24, CU: 1.32, ZN: 1.22, SE: 1.2, BR: 1.2, I: 1.39, MO: 1.54,
};

/** CPK-style colors as packed 0xRRGGBB. */
const ELEMENT_COLORS: Record<string, number> = {
  H: 0xffffff, C: 0x909090, N: 0x3050f8, O: 0xff0d0d, F: 0x90e050,
  NA: 0xab5cf2, MG: 0x8aff00, P: 0xff8000, S: 0xffff30, CL: 0x1ff01f,
  K: 0x8f40d4, CA: 0x3dff00, FE: 0xe06633, MN: 0x9c7ac7, CO: 0xf090a0,
  NI: 0x50d050, CU: 0xc88033, ZN: 0x7d80b0, SE: 0xffa100, BR: 0xa62929,
  I: 0x940094, MO: 0x54b5b5,
};

const DEFAULT_VDW = 1.7;
const DEFAULT_COVALENT = 0.77;
const DEFAULT_COLOR = 0xff1493;

export function vdwRadius(element: string): number {
  return VDW_RADII[element.toUpperCase()] ?? DEFAULT_VDW;
}

export function covalentRadius(element: string): number {
  return COVALENT_RADII[element.toUpperCase()] ?? DEFAULT_COVALENT;
}

export function elementColor(element: string): number {
  return ELEMENT_COLORS[element.toUpperCase()] ?? DEFAULT_COLOR;
}

/**
 * Recovers the element symbol from a PDB atom name when the element column is
 * absent or blank. PDB atom names are column-aligned: a leading character in
 * column 13 belongs to the element only for two-character symbols, so a name
 * like "CA" in a metal record is calcium while " CA " in a residue is carbon.
 * Without columns we fall back to name heuristics, which is what most
 * malformed files require anyway.
 */
export function inferElement(atomName: string, rawColumn13?: string): string {
  const name = atomName.trim().toUpperCase();
  if (name.length === 0) return 'C';

  // Hydrogens are frequently named 1HB, HD21, etc.
  if (/^[0-9]*H/.test(name)) return 'H';

  if (rawColumn13 !== undefined && rawColumn13 !== ' ' && name.length >= 2) {
    const two = name.slice(0, 2);
    if (VDW_RADII[two] !== undefined) return two;
  }

  const first = name[0];
  if (VDW_RADII[first] !== undefined) return first;

  const two = name.slice(0, 2);
  if (VDW_RADII[two] !== undefined) return two;

  return first;
}

/** Uppercases an element symbol from a file column, defaulting to carbon. */
export function normalizeElement(raw: string): string {
  const trimmed = raw.trim().toUpperCase();
  return trimmed === '' ? 'C' : trimmed;
}

const HBOND_DONORS = new Set(['N', 'O', 'S']);
const HBOND_ACCEPTORS = new Set(['N', 'O', 'S']);

export function isHBondDonor(element: string): boolean {
  return HBOND_DONORS.has(element.toUpperCase());
}

export function isHBondAcceptor(element: string): boolean {
  return HBOND_ACCEPTORS.has(element.toUpperCase());
}
