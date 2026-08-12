import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { partialCharge } from './charges';
import { parseCif } from './cif';
import {
  chainSelection,
  scoreInterface,
  translateSelection,
} from './interactions';
import { buildStructure } from './testHelpers';

function pair(distance: number, options?: { elementA?: string; elementB?: string; residueA?: string; residueB?: string; nameA?: string; nameB?: string }) {
  const structure = buildStructure([
    {
      name: options?.nameA ?? 'CB',
      element: options?.elementA ?? 'C',
      x: 0,
      y: 0,
      z: 0,
      residueName: options?.residueA ?? 'ALA',
      residueSeq: 1,
      chainId: 'A',
    },
    {
      name: options?.nameB ?? 'CB',
      element: options?.elementB ?? 'C',
      x: distance,
      y: 0,
      z: 0,
      residueName: options?.residueB ?? 'ALA',
      residueSeq: 1,
      chainId: 'B',
    },
  ]);
  return { structure, a: [0], b: [1] };
}

describe('scoreInterface', () => {
  it('reports nothing when the partners are beyond the contact cut-off', () => {
    const { structure, a, b } = pair(12);
    const result = scoreInterface(structure, a, b);
    expect(result.contactCount).toBe(0);
    expect(result.interactionScore).toBe(0);
    expect(result.clashes).toEqual([]);
    expect(result.hydrogenBonds).toEqual([]);
    expect(result.buriedArea).toBe(0);
  });

  it('flags a steric clash and penalises it when atoms interpenetrate', () => {
    const { structure, a, b } = pair(1.8);
    const result = scoreInterface(structure, a, b);
    expect(result.clashes).toHaveLength(1);
    expect(result.clashes[0].overlap).toBeCloseTo(3.4 - 1.8, 5);
    expect(result.terms.clashPenalty).toBeGreaterThan(0);
    expect(result.interactionScore).toBeGreaterThan(0);
  });

  it('is favourable at van der Waals contact distance', () => {
    const { structure, a, b } = pair(3.4);
    const result = scoreInterface(structure, a, b);
    expect(result.terms.vanDerWaals).toBeLessThan(0);
    expect(result.clashes).toEqual([]);
  });

  it('detects a hydrogen bond between polar heavy atoms at 2.9 A', () => {
    const { structure, a, b } = pair(2.9, {
      elementA: 'N',
      elementB: 'O',
      nameA: 'ND2',
      nameB: 'OE1',
      residueA: 'ASN',
      residueB: 'GLN',
    });
    const result = scoreInterface(structure, a, b);
    expect(result.hydrogenBonds).toHaveLength(1);
    expect(result.hydrogenBonds[0].distance).toBeCloseTo(2.9, 6);
    expect(result.terms.hydrogenBond).toBeLessThan(0);
  });

  it('does not call a carbon-carbon contact a hydrogen bond', () => {
    const { structure, a, b } = pair(2.9);
    expect(scoreInterface(structure, a, b).hydrogenBonds).toEqual([]);
  });

  it('rewards opposite charges and penalises like charges', () => {
    const saltBridge = pair(3.0, {
      elementA: 'N',
      elementB: 'O',
      nameA: 'NZ',
      nameB: 'OD1',
      residueA: 'LYS',
      residueB: 'ASP',
    });
    const repulsive = pair(3.0, {
      elementA: 'O',
      elementB: 'O',
      nameA: 'OD1',
      nameB: 'OD1',
      residueA: 'ASP',
      residueB: 'ASP',
    });

    const attraction = scoreInterface(
      saltBridge.structure,
      saltBridge.a,
      saltBridge.b,
    ).terms.electrostatic;
    const repulsion = scoreInterface(
      repulsive.structure,
      repulsive.a,
      repulsive.b,
    ).terms.electrostatic;

    expect(attraction).toBeLessThan(0);
    expect(repulsion).toBeGreaterThan(0);
  });

  it('weakens monotonically as the partner is pulled away', () => {
    const structure = parseCif(
      readFileSync(join(process.cwd(), 'src/data/bundled/1BRS.cif'), 'utf8'),
      '1BRS',
    );
    const a = chainSelection(structure, 'A').indices;
    const b = chainSelection(structure, 'D').indices;
    expect(a.length).toBeGreaterThan(500);
    expect(b.length).toBeGreaterThan(300);

    const axis: [number, number, number] = [1, 0, 0];
    const scores = [0, 6, 14, 40].map((offset) => {
      const posed = translateSelection(structure, b, [
        axis[0] * offset,
        axis[1] * offset,
        axis[2] * offset,
      ]);
      return scoreInterface(posed, a, b);
    });

    // The native interface must be the most favourable pose, contacts must fall
    // off with separation, and a fully separated pose must score exactly zero.
    expect(scores[0].interactionScore).toBeLessThan(scores[1].interactionScore);
    expect(scores[0].contactCount).toBeGreaterThan(scores[1].contactCount);
    expect(scores[3].contactCount).toBe(0);
    expect(scores[3].interactionScore).toBe(0);
  });

  it('buries surface area at the native barnase-barstar interface', () => {
    const structure = parseCif(
      readFileSync(join(process.cwd(), 'src/data/bundled/1BRS.cif'), 'utf8'),
      '1BRS',
    );
    const a = chainSelection(structure, 'A').indices;
    const b = chainSelection(structure, 'D').indices;
    const result = scoreInterface(structure, a, b);

    // Published barnase-barstar interfaces bury roughly 1500 A^2 total.
    expect(result.buriedArea).toBeGreaterThan(800);
    expect(result.buriedArea).toBeLessThan(3000);
    expect(result.hydrogenBonds.length).toBeGreaterThan(5);
    expect(result.terms.desolvation).toBeLessThan(0);
  });
});

describe('translateSelection', () => {
  it('moves only the selected atoms', () => {
    const { structure, b } = pair(4);
    const moved = translateSelection(structure, b, [0, 3, 0]);
    expect(moved.atoms[0].y).toBe(0);
    expect(moved.atoms[1].y).toBe(3);
    expect(structure.atoms[1].y).toBe(0);
  });
});

describe('chainSelection', () => {
  it('excludes hetero residues unless asked for them', () => {
    const structure = buildStructure([
      { name: 'CA', element: 'C', x: 0, y: 0, z: 0, chainId: 'A', residueSeq: 1 },
      {
        name: 'O',
        element: 'O',
        x: 5,
        y: 0,
        z: 0,
        chainId: 'A',
        residueSeq: 500,
        residueName: 'HOH',
        hetero: true,
      },
    ]);
    expect(chainSelection(structure, 'A').indices).toEqual([0]);
    expect(chainSelection(structure, 'A', true).indices).toEqual([0, 1]);
    expect(chainSelection(structure, 'Z').indices).toEqual([]);
  });
});

describe('partialCharge', () => {
  it('charges ionisable side chains and leaves apolar atoms neutral', () => {
    expect(partialCharge('LYS', 'NZ')).toBeGreaterThan(0);
    expect(partialCharge('ASP', 'OD1')).toBeLessThan(0);
    expect(partialCharge('ALA', 'CB')).toBe(0);
  });

  it('charges the nucleic acid phosphate backbone', () => {
    expect(partialCharge('DA', 'P')).toBeGreaterThan(0);
    expect(partialCharge('DA', 'OP1')).toBeLessThan(0);
  });
});
