import { isNonpolar, partialCharge } from './charges';
import { isHBondAcceptor, isHBondDonor, vdwRadius } from './elements';
import { NeighborGrid } from './grid';
import { solventAccessibleArea, totalArea } from './sasa';
import type { Atom, Structure } from './types';

/** Interface cut-off: no pair beyond this contributes to any term. */
const CONTACT_CUTOFF = 6.0;
const HBOND_MIN = 2.4;
const HBOND_MAX = 3.5;
/** vdW overlap beyond this is drawn as a steric clash. */
const CLASH_OVERLAP = 0.5;
const DIELECTRIC_SLOPE = 4.0;

export interface Clash {
  a: number;
  b: number;
  distance: number;
  overlap: number;
}

export interface HydrogenBond {
  donor: number;
  acceptor: number;
  distance: number;
}

export interface InteractionTerms {
  vanDerWaals: number;
  electrostatic: number;
  hydrogenBond: number;
  desolvation: number;
  clashPenalty: number;
}

export interface InteractionResult {
  /**
   * Relative interaction score in arbitrary units. Lower is more favourable.
   * This is NOT a binding free energy and must never be presented as kcal/mol
   * or as a predicted affinity: it is a rigid-body empirical score intended for
   * comparing states of the same complex in a teaching context.
   */
  interactionScore: number;
  terms: InteractionTerms;
  contactCount: number;
  clashes: Clash[];
  hydrogenBonds: HydrogenBond[];
  /** Buried surface area in A^2, from the SASA difference on interface atoms. */
  buriedArea: number;
}

export interface Selection {
  /** Atom indices into `structure.atoms`. */
  indices: number[];
  label: string;
}

/**
 * Scores the interface between two atom selections of one structure.
 *
 * Terms: a softened Lennard-Jones-style vdW well, Coulomb with a
 * distance-dependent dielectric, a geometric heavy-atom hydrogen-bond term, and
 * a nonpolar desolvation reward proportional to buried area. Rigid bodies only.
 */
export function scoreInterface(
  structure: Structure,
  groupA: readonly number[],
  groupB: readonly number[],
): InteractionResult {
  const atoms = structure.atoms;
  const inA = new Uint8Array(atoms.length);
  for (const i of groupA) inA[i] = 1;

  const bAtoms = groupB.map((i) => atoms[i]);
  const grid = new NeighborGrid(bAtoms, CONTACT_CUTOFF);

  const terms: InteractionTerms = {
    vanDerWaals: 0,
    electrostatic: 0,
    hydrogenBond: 0,
    desolvation: 0,
    clashPenalty: 0,
  };
  const clashes: Clash[] = [];
  const hydrogenBonds: HydrogenBond[] = [];
  const interfaceAtoms = new Set<number>();
  let contactCount = 0;

  for (const ia of groupA) {
    const a = atoms[ia];
    const ra = vdwRadius(a.element);
    const qa = partialCharge(structure.residues[a.residueIndex].name, a.name);

    grid.forEachWithin(a.x, a.y, a.z, CONTACT_CUTOFF, (localIndex, d2) => {
      const ib = groupB[localIndex];
      const b = atoms[ib];
      const d = Math.sqrt(d2);
      if (d < 1e-6) return;

      contactCount++;
      interfaceAtoms.add(ia);
      interfaceAtoms.add(ib);

      const rb = vdwRadius(b.element);
      const sigma = ra + rb;

      // Softened 8-4 well: gentler than 12-6 so that a user dragging molecules
      // together sees a smooth score change instead of a numeric explosion.
      const ratio = sigma / d;
      const vdw = 0.15 * (Math.pow(ratio, 8) - 2 * Math.pow(ratio, 4));
      terms.vanDerWaals += Math.min(vdw, 10);

      const qb = partialCharge(structure.residues[b.residueIndex].name, b.name);
      if (qa !== 0 && qb !== 0) {
        terms.electrostatic += (332 * qa * qb) / (DIELECTRIC_SLOPE * d * d);
      }

      if (d >= HBOND_MIN && d <= HBOND_MAX) {
        const donorFirst = isHBondDonor(a.element) && isHBondAcceptor(b.element);
        const acceptorFirst = isHBondAcceptor(a.element) && isHBondDonor(b.element);
        if (donorFirst || acceptorFirst) {
          // Linear ramp peaking at the ideal 2.9 A heavy-atom separation.
          const strength = 1 - Math.abs(d - 2.9) / (HBOND_MAX - 2.9);
          if (strength > 0) {
            terms.hydrogenBond -= 2.0 * strength;
            hydrogenBonds.push({ donor: ia, acceptor: ib, distance: d });
          }
        }
      }

      const overlap = sigma - d;
      if (overlap > CLASH_OVERLAP) {
        terms.clashPenalty += 5 * (overlap - CLASH_OVERLAP) ** 2;
        clashes.push({ a: ia, b: ib, distance: d, overlap });
      }
    });
  }

  const buriedArea = computeBuriedArea(structure, groupA, groupB, interfaceAtoms, inA);
  let nonpolarFraction = 0;
  if (interfaceAtoms.size > 0) {
    let nonpolar = 0;
    for (const i of interfaceAtoms) if (isNonpolar(atoms[i].element)) nonpolar++;
    nonpolarFraction = nonpolar / interfaceAtoms.size;
  }
  terms.desolvation = -0.025 * buriedArea * nonpolarFraction;

  const interactionScore =
    terms.vanDerWaals +
    terms.electrostatic +
    terms.hydrogenBond +
    terms.desolvation +
    terms.clashPenalty;

  return {
    interactionScore,
    terms,
    contactCount,
    clashes,
    hydrogenBonds,
    buriedArea,
  };
}

/**
 * Buried area from SASA(A) + SASA(B) - SASA(AB), evaluated only on atoms near
 * the interface. Restricting the subset is what keeps this affordable: full-atom
 * SASA on a large complex is far too slow for an interactive slider.
 */
function computeBuriedArea(
  structure: Structure,
  groupA: readonly number[],
  groupB: readonly number[],
  interfaceAtoms: ReadonlySet<number>,
  inA: Uint8Array,
): number {
  if (interfaceAtoms.size === 0) return 0;

  const atoms = structure.atoms;
  const aSubsetGlobal: number[] = [];
  const bSubsetGlobal: number[] = [];
  for (const i of interfaceAtoms) {
    if (inA[i]) aSubsetGlobal.push(i);
    else bSubsetGlobal.push(i);
  }

  const aAtoms = groupA.map((i) => atoms[i]);
  const bAtoms = groupB.map((i) => atoms[i]);
  const complexAtoms = [...aAtoms, ...bAtoms];

  const globalToA = new Map<number, number>();
  groupA.forEach((g, local) => globalToA.set(g, local));
  const globalToB = new Map<number, number>();
  groupB.forEach((g, local) => globalToB.set(g, local));

  const aSubset = aSubsetGlobal.map((g) => globalToA.get(g)!).filter((v) => v !== undefined);
  const bSubset = bSubsetGlobal.map((g) => globalToB.get(g)!).filter((v) => v !== undefined);
  const complexSubset = [
    ...aSubset,
    ...bSubset.map((local) => local + aAtoms.length),
  ];

  const areaA = totalArea(solventAccessibleArea(aAtoms, aSubset));
  const areaB = totalArea(solventAccessibleArea(bAtoms, bSubset));
  const areaComplex = totalArea(solventAccessibleArea(complexAtoms, complexSubset));
  return Math.max(0, areaA + areaB - areaComplex);
}

/** Atom indices of a chain, optionally excluding solvent and other heteroatoms. */
export function chainSelection(
  structure: Structure,
  chainId: string,
  includeHetero = false,
): Selection {
  const chain = structure.chains.find((c) => c.id === chainId);
  const indices: number[] = [];
  if (chain) {
    for (const residueIndex of chain.residueIndices) {
      const residue = structure.residues[residueIndex];
      if (!includeHetero && residue.hetero) continue;
      indices.push(...residue.atomIndices);
    }
  }
  return { indices, label: `Chain ${chainId}` };
}

/** Residues of `groupA` that contact `groupB`, for highlighting the epitope. */
export function interfaceResidues(
  structure: Structure,
  result: InteractionResult,
): Set<number> {
  const residues = new Set<number>();
  for (const clash of result.clashes) {
    residues.add(structure.atoms[clash.a].residueIndex);
    residues.add(structure.atoms[clash.b].residueIndex);
  }
  for (const hbond of result.hydrogenBonds) {
    residues.add(structure.atoms[hbond.donor].residueIndex);
    residues.add(structure.atoms[hbond.acceptor].residueIndex);
  }
  return residues;
}

/** Copies a structure with `groupB` atoms rigidly translated by `offset`. */
export function translateSelection(
  structure: Structure,
  group: readonly number[],
  offset: readonly [number, number, number],
): Structure {
  const moved = new Uint8Array(structure.atoms.length);
  for (const i of group) moved[i] = 1;
  const atoms: Atom[] = structure.atoms.map((atom) =>
    moved[atom.index]
      ? { ...atom, x: atom.x + offset[0], y: atom.y + offset[1], z: atom.z + offset[2] }
      : atom,
  );
  return { ...structure, atoms };
}
