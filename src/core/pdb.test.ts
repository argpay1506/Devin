import { describe, expect, it } from 'vitest';
import { inferElement } from './elements';
import { parsePdb } from './pdb';

// Column-exact PDB records; the parser depends on the fixed layout.
const SAMPLE = [
  'HEADER    PLANT PROTEIN                           30-APR-81   1CRN',
  'TITLE     WATER STRUCTURE OF A HYDROPHOBIC PROTEIN AT ATOMIC',
  'TITLE    2 RESOLUTION',
  'HELIX    1  H1 ILE A    7  PRO A   19  1                                  13',
  'SHEET    1  S1 2 THR A   1  CYS A   4  0',
  'ATOM      1  N   THR A   1      17.047  14.099   3.625  1.00 13.79           N',
  'ATOM      2  CA  THR A   1      16.967  12.784   4.338  1.00 10.80           C',
  'ATOM      3  C   THR A   1      15.685  12.755   5.133  1.00  9.19           C',
  'ATOM      4  O   THR A   1      15.268  13.825   5.594  1.00  9.85           O',
  'ATOM     26  CA  ILE A   7      12.117   8.856   6.208  1.00  8.00           C',
  'ATOM     40  CA  PRO A  19      10.000  10.000  10.000  1.00  8.00           C',
  'ATOM     41  CB AGLU A  20       1.000   1.000   1.000  0.50  8.00           C',
  'ATOM     42  CB BGLU A  20       1.400   1.000   1.000  0.50  8.00           C',
  'HETATM   50 ZN    ZN A 100       5.000   5.000   5.000  1.00 20.00          ZN',
  'HETATM   51  O   HOH A 200       9.000   9.000   9.000  1.00 30.00           O',
  'ENDMDL',
  'ATOM     60  CA  ALA B   1      99.000  99.000  99.000  1.00  8.00           C',
  'END',
].join('\n');

describe('parsePdb', () => {
  it('reads the entry id and folded title', () => {
    const structure = parsePdb(SAMPLE);
    expect(structure.id).toBe('1CRN');
    expect(structure.title).toBe(
      'WATER STRUCTURE OF A HYDROPHOBIC PROTEIN AT ATOMIC RESOLUTION',
    );
  });

  it('parses fixed columns into coordinates and metadata', () => {
    const structure = parsePdb(SAMPLE);
    const first = structure.atoms[0];
    expect(first.name).toBe('N');
    expect(first.element).toBe('N');
    expect(first.x).toBeCloseTo(17.047, 3);
    expect(first.y).toBeCloseTo(14.099, 3);
    expect(first.z).toBeCloseTo(3.625, 3);
    expect(first.bFactor).toBeCloseTo(13.79, 2);
    expect(structure.residues[first.residueIndex].name).toBe('THR');
  });

  it('keeps only the primary alternate conformer', () => {
    const structure = parsePdb(SAMPLE);
    const glu = structure.atoms.filter(
      (atom) => structure.residues[atom.residueIndex].seq === 20,
    );
    expect(glu).toHaveLength(1);
    expect(glu[0].x).toBeCloseTo(1.0, 3);
  });

  it('stops at ENDMDL so an NMR ensemble does not stack', () => {
    const structure = parsePdb(SAMPLE);
    expect(structure.chains.map((c) => c.id)).toEqual(['A']);
  });

  it('marks heteroatoms and solvent as hetero residues', () => {
    const structure = parsePdb(SAMPLE);
    const zinc = structure.atoms.find((atom) => atom.element === 'ZN');
    expect(zinc).toBeDefined();
    expect(structure.residues[zinc!.residueIndex].hetero).toBe(true);
    const water = structure.residues.find((residue) => residue.name === 'HOH');
    expect(water?.hetero).toBe(true);
  });

  it('applies HELIX and SHEET ranges to the residues they cover', () => {
    const structure = parsePdb(SAMPLE);
    const bySeq = (seq: number) => structure.residues.find((r) => r.seq === seq);
    expect(bySeq(7)?.secondaryStructure).toBe('helix');
    expect(bySeq(19)?.secondaryStructure).toBe('helix');
    expect(bySeq(1)?.secondaryStructure).toBe('sheet');
  });
});

describe('inferElement', () => {
  it('recognises hydrogens with numeric prefixes', () => {
    expect(inferElement('1HB')).toBe('H');
    expect(inferElement('HD21')).toBe('H');
  });

  it('prefers the two-character symbol when column 13 is occupied', () => {
    expect(inferElement('ZN', 'Z')).toBe('ZN');
    expect(inferElement('CA', ' ')).toBe('C');
  });

  it('falls back to the leading character for ordinary atom names', () => {
    expect(inferElement('OD1')).toBe('O');
    expect(inferElement('CB')).toBe('C');
  });
});
