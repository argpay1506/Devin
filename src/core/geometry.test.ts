import { describe, expect, it } from 'vitest';
import { backboneTraces, inferBonds } from './bonds';
import { NeighborGrid } from './grid';
import { PROBE_RADIUS, solventAccessibleArea, totalArea } from './sasa';
import { assignSecondaryStructure } from './secondaryStructure';
import { centroid, subStructure } from './subset';
import { buildStructure, idealHelixTrace, idealStrandTrace } from './testHelpers';
import { vdwRadius } from './elements';

describe('NeighborGrid', () => {
  it('finds exactly the atoms inside the query radius', () => {
    const structure = buildStructure([
      { name: 'C1', element: 'C', x: 0, y: 0, z: 0 },
      { name: 'C2', element: 'C', x: 1, y: 0, z: 0 },
      { name: 'C3', element: 'C', x: 5, y: 0, z: 0 },
      { name: 'C4', element: 'C', x: 20, y: 0, z: 0 },
    ]);
    const grid = new NeighborGrid(structure.atoms, 2);

    const found: number[] = [];
    grid.forEachWithin(0, 0, 0, 5.5, (index) => found.push(index));
    expect(found.sort()).toEqual([0, 1, 2]);
  });

  it('handles an empty atom list', () => {
    const grid = new NeighborGrid([], 2);
    const found: number[] = [];
    grid.forEachWithin(0, 0, 0, 10, (index) => found.push(index));
    expect(found).toEqual([]);
  });
});

describe('inferBonds', () => {
  it('bonds atoms at covalent distance and ignores distant pairs', () => {
    const structure = buildStructure([
      { name: 'C', element: 'C', x: 0, y: 0, z: 0 },
      { name: 'O', element: 'O', x: 1.23, y: 0, z: 0 },
      { name: 'C2', element: 'C', x: 6, y: 0, z: 0 },
    ]);
    const bonds = inferBonds(structure);
    expect(bonds).toEqual([{ a: 0, b: 1 }]);
  });

  it('never bonds hydrogen to hydrogen', () => {
    const structure = buildStructure([
      { name: 'H1', element: 'H', x: 0, y: 0, z: 0 },
      { name: 'H2', element: 'H', x: 0.75, y: 0, z: 0 },
    ]);
    expect(inferBonds(structure)).toEqual([]);
  });

  it('produces the expected bond count for a benzene ring', () => {
    const atoms = Array.from({ length: 6 }, (_, i) => {
      const angle = (i / 6) * Math.PI * 2;
      return {
        name: `C${i}`,
        element: 'C',
        x: 1.39 * Math.cos(angle),
        y: 1.39 * Math.sin(angle),
        z: 0,
        residueName: 'BNZ',
        residueSeq: 1,
      };
    });
    expect(inferBonds(buildStructure(atoms))).toHaveLength(6);
  });
});

describe('backboneTraces', () => {
  it('splits a chain where the CA-CA distance jumps', () => {
    const first = idealHelixTrace(6).map((atom, i) => ({ ...atom, residueSeq: i + 1 }));
    const gapped = idealHelixTrace(6).map((atom, i) => ({
      ...atom,
      z: atom.z + 40,
      residueSeq: i + 20,
    }));
    const structure = buildStructure([...first, ...gapped]);
    const traces = backboneTraces(structure);
    expect(traces).toHaveLength(2);
    expect(traces[0]).toHaveLength(6);
    expect(traces[1]).toHaveLength(6);
  });

  it('returns one trace per chain', () => {
    const structure = buildStructure([
      ...idealHelixTrace(8, 'A'),
      ...idealHelixTrace(8, 'B'),
    ]);
    expect(backboneTraces(structure)).toHaveLength(2);
  });
});

describe('assignSecondaryStructure', () => {
  it('labels an ideal alpha helix as helix', () => {
    const structure = buildStructure(idealHelixTrace(14));
    assignSecondaryStructure(structure);
    const helix = structure.residues.filter((r) => r.secondaryStructure === 'helix');
    expect(helix.length).toBeGreaterThanOrEqual(10);
    expect(structure.residues.some((r) => r.secondaryStructure === 'sheet')).toBe(false);
  });

  it('labels an extended strand as sheet', () => {
    const structure = buildStructure(idealStrandTrace(12));
    assignSecondaryStructure(structure);
    const sheet = structure.residues.filter((r) => r.secondaryStructure === 'sheet');
    expect(sheet.length).toBeGreaterThanOrEqual(8);
    expect(structure.residues.some((r) => r.secondaryStructure === 'helix')).toBe(false);
  });

  it('leaves a short irregular run as coil', () => {
    const structure = buildStructure([
      { name: 'CA', element: 'C', x: 0, y: 0, z: 0, residueSeq: 1 },
      { name: 'CA', element: 'C', x: 3.8, y: 0.4, z: 0.2, residueSeq: 2 },
      { name: 'CA', element: 'C', x: 7.0, y: 2.2, z: 1.1, residueSeq: 3 },
      { name: 'CA', element: 'C', x: 9.4, y: 5.0, z: 0.3, residueSeq: 4 },
      { name: 'CA', element: 'C', x: 12.5, y: 6.1, z: 2.4, residueSeq: 5 },
      { name: 'CA', element: 'C', x: 15.0, y: 8.4, z: 1.0, residueSeq: 6 },
    ]);
    assignSecondaryStructure(structure);
    expect(structure.residues.every((r) => r.secondaryStructure === 'coil')).toBe(true);
  });
});

describe('solventAccessibleArea', () => {
  it('gives an isolated atom the full sphere area within integration error', () => {
    const structure = buildStructure([{ name: 'C', element: 'C', x: 0, y: 0, z: 0 }]);
    const radius = vdwRadius('C') + PROBE_RADIUS;
    const expected = 4 * Math.PI * radius * radius;
    const area = totalArea(solventAccessibleArea(structure.atoms));
    expect(area).toBeCloseTo(expected, 5);
  });

  it('reduces exposure when a neighbour occludes part of the surface', () => {
    const alone = buildStructure([{ name: 'C', element: 'C', x: 0, y: 0, z: 0 }]);
    const pair = buildStructure([
      { name: 'C', element: 'C', x: 0, y: 0, z: 0 },
      { name: 'C', element: 'C', x: 1.5, y: 0, z: 0 },
    ]);
    const single = solventAccessibleArea(alone.atoms).get(0)!;
    const occluded = solventAccessibleArea(pair.atoms).get(0)!;
    expect(occluded).toBeLessThan(single);
    expect(occluded).toBeGreaterThan(0);
  });

  it('measures only the requested subset', () => {
    const structure = buildStructure([
      { name: 'C', element: 'C', x: 0, y: 0, z: 0 },
      { name: 'C', element: 'C', x: 30, y: 0, z: 0 },
    ]);
    const areas = solventAccessibleArea(structure.atoms, [1]);
    expect([...areas.keys()]).toEqual([1]);
  });
});

describe('subStructure', () => {
  it('re-indexes atoms, residues, and chains consistently', () => {
    const structure = buildStructure([
      { name: 'CA', element: 'C', x: 0, y: 0, z: 0, chainId: 'A', residueSeq: 1 },
      { name: 'CB', element: 'C', x: 1, y: 0, z: 0, chainId: 'A', residueSeq: 1 },
      { name: 'CA', element: 'C', x: 0, y: 5, z: 0, chainId: 'B', residueSeq: 1 },
    ]);
    const subset = subStructure(structure, [2]);

    expect(subset.atoms).toHaveLength(1);
    expect(subset.atoms[0].index).toBe(0);
    expect(subset.atoms[0].residueIndex).toBe(0);
    expect(subset.residues[0].atomIndices).toEqual([0]);
    expect(subset.chains).toHaveLength(1);
    expect(subset.chains[0].id).toBe('B');
    expect(subset.chains[0].residueIndices).toEqual([0]);
  });

  it('computes the centroid of the extracted atoms', () => {
    const structure = buildStructure([
      { name: 'CA', element: 'C', x: -2, y: 0, z: 0 },
      { name: 'CA', element: 'C', x: 2, y: 4, z: 0, residueSeq: 2 },
    ]);
    expect(centroid(structure)).toEqual([0, 2, 0]);
  });
});
