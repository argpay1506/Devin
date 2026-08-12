import { backboneTraces } from './bonds';
import type { Atom, SecondaryStructure, Structure } from './types';

interface Criterion {
  target: number;
  tolerance: number;
}

/**
 * P-SEA style criteria: CA-only secondary structure assignment from the
 * distances d(i, i+2..4) plus the CA pseudo-angle and pseudo-torsion. Chosen
 * over DSSP because it needs no hydrogens and no backbone amide geometry, so it
 * still works on CA-only depositions and coarse models.
 */
const HELIX = {
  d2: { target: 5.5, tolerance: 0.5 },
  d3: { target: 5.3, tolerance: 0.5 },
  d4: { target: 6.4, tolerance: 0.6 },
  angle: { target: 89, tolerance: 12 },
  torsion: { target: 90, tolerance: 30 },
} satisfies Record<string, Criterion>;

const SHEET = {
  d2: { target: 6.7, tolerance: 0.6 },
  d3: { target: 9.9, tolerance: 0.9 },
  d4: { target: 12.4, tolerance: 1.1 },
  angle: { target: 124, tolerance: 14 },
  torsion: { target: -170, tolerance: 45 },
} satisfies Record<string, Criterion>;

const MIN_HELIX_RUN = 4;
const MIN_SHEET_RUN = 3;

function within(value: number, criterion: Criterion): boolean {
  return Math.abs(value - criterion.target) <= criterion.tolerance;
}

function distance(a: Atom, b: Atom): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function pseudoAngle(a: Atom, b: Atom, c: Atom): number {
  const v1 = [a.x - b.x, a.y - b.y, a.z - b.z];
  const v2 = [c.x - b.x, c.y - b.y, c.z - b.z];
  const dot = v1[0] * v2[0] + v1[1] * v2[1] + v1[2] * v2[2];
  const n1 = Math.hypot(v1[0], v1[1], v1[2]);
  const n2 = Math.hypot(v2[0], v2[1], v2[2]);
  if (n1 === 0 || n2 === 0) return 0;
  const cos = Math.min(1, Math.max(-1, dot / (n1 * n2)));
  return (Math.acos(cos) * 180) / Math.PI;
}

function pseudoTorsion(a: Atom, b: Atom, c: Atom, d: Atom): number {
  const b1 = [b.x - a.x, b.y - a.y, b.z - a.z];
  const b2 = [c.x - b.x, c.y - b.y, c.z - b.z];
  const b3 = [d.x - c.x, d.y - c.y, d.z - c.z];

  const cross = (u: number[], v: number[]): number[] => [
    u[1] * v[2] - u[2] * v[1],
    u[2] * v[0] - u[0] * v[2],
    u[0] * v[1] - u[1] * v[0],
  ];
  const n1 = cross(b1, b2);
  const n2 = cross(b2, b3);
  const m = cross(n1, b2.map((v) => v / (Math.hypot(b2[0], b2[1], b2[2]) || 1)));
  const x = n1[0] * n2[0] + n1[1] * n2[1] + n1[2] * n2[2];
  const y = m[0] * n2[0] + m[1] * n2[1] + m[2] * n2[2];
  return (Math.atan2(y, x) * 180) / Math.PI;
}

/**
 * Assigns secondary structure geometrically for every polymer residue on a
 * backbone trace. Existing assignments (from HELIX/SHEET or _struct_conf) are
 * preserved unless `force` is set.
 */
export function assignSecondaryStructure(structure: Structure, force = false): void {
  const hasExplicit = structure.residues.some((r) => r.secondaryStructure !== 'coil');
  if (hasExplicit && !force) return;

  for (const trace of backboneTraces(structure)) {
    const atoms = trace.map((i) => structure.atoms[i]);
    const n = atoms.length;
    const votes: SecondaryStructure[] = new Array(n).fill('coil');

    for (let i = 0; i + 4 < n; i++) {
      const d2 = distance(atoms[i], atoms[i + 2]);
      const d3 = distance(atoms[i], atoms[i + 3]);
      const d4 = distance(atoms[i], atoms[i + 4]);
      const angle = pseudoAngle(atoms[i], atoms[i + 1], atoms[i + 2]);
      const torsion = pseudoTorsion(atoms[i], atoms[i + 1], atoms[i + 2], atoms[i + 3]);

      const helixByDistance =
        within(d2, HELIX.d2) && within(d3, HELIX.d3) && within(d4, HELIX.d4);
      const helixByAngle = within(angle, HELIX.angle) && within(torsion, HELIX.torsion);
      const sheetByDistance =
        within(d2, SHEET.d2) && within(d3, SHEET.d3) && within(d4, SHEET.d4);
      const sheetByAngle = within(angle, SHEET.angle) && within(torsion, SHEET.torsion);

      let kind: SecondaryStructure = 'coil';
      if (helixByDistance || helixByAngle) kind = 'helix';
      else if (sheetByDistance || sheetByAngle) kind = 'sheet';
      if (kind === 'coil') continue;

      const span = kind === 'helix' ? 4 : 2;
      for (let k = i; k <= i + span; k++) votes[k] = kind;
    }

    pruneShortRuns(votes);

    for (let i = 0; i < n; i++) {
      const residueIndex = structure.atoms[trace[i]].residueIndex;
      structure.residues[residueIndex].secondaryStructure = votes[i];
    }
  }
}

/** Drops runs too short to be a real helix or strand. */
function pruneShortRuns(votes: SecondaryStructure[]): void {
  let start = 0;
  while (start < votes.length) {
    const kind = votes[start];
    let end = start;
    while (end + 1 < votes.length && votes[end + 1] === kind) end++;
    const length = end - start + 1;
    const minimum = kind === 'helix' ? MIN_HELIX_RUN : kind === 'sheet' ? MIN_SHEET_RUN : 0;
    if (kind !== 'coil' && length < minimum) {
      for (let i = start; i <= end; i++) votes[i] = 'coil';
    }
    start = end + 1;
  }
}
