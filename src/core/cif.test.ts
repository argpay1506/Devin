import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseCif, parseStructure } from './cif';
import { isCifNull, tokenizeCif } from './cifTokenizer';
import { assignSecondaryStructure } from './secondaryStructure';
import { structureStats } from './types';

const BUNDLED = join(process.cwd(), 'src/data/bundled');

function readBundled(id: string): string {
  return readFileSync(join(BUNDLED, `${id}.cif`), 'utf8');
}

describe('tokenizeCif', () => {
  it('reads bare, quoted, and semicolon-delimited values', () => {
    const text = [
      'data_TEST',
      '_entry.id TEST',
      "_struct.title 'A quoted title'",
      '_note.text',
      ';A multiline',
      'text block',
      ';',
      'loop_',
      '_thing.a',
      '_thing.b',
      '1 2',
      '3 ?',
    ].join('\n');

    const tokens = [...tokenizeCif(text)];
    expect(tokens[0]).toEqual({ kind: 'data', name: 'TEST' });
    expect(tokens).toContainEqual({ kind: 'value', value: 'A quoted title' });
    expect(tokens).toContainEqual({ kind: 'value', value: 'A multiline\ntext block' });
    expect(tokens).toContainEqual({ kind: 'loop' });
    expect(tokens.filter((t) => t.kind === 'tag').map((t) => t.name)).toEqual([
      '_entry.id',
      '_struct.title',
      '_note.text',
      '_thing.a',
      '_thing.b',
    ]);
  });

  it('treats . and ? as null', () => {
    expect(isCifNull('.')).toBe(true);
    expect(isCifNull('?')).toBe(true);
    expect(isCifNull('0')).toBe(false);
  });

  it('keeps apostrophes inside quoted values', () => {
    const tokens = [...tokenizeCif("_a.b 'it's fine' ")];
    expect(tokens).toContainEqual({ kind: 'value', value: "it's fine" });
  });
});

describe('parseCif', () => {
  it('parses crambin with every atom accounted for', () => {
    const structure = parseCif(readBundled('1CRN'), '1CRN');
    const stats = structureStats(structure);
    expect(structure.id).toBe('1CRN');
    expect(stats.atoms).toBe(327);
    expect(stats.chains).toBe(1);
    expect(stats.polymerResidues).toBe(46);
    expect(structure.title.toLowerCase()).toContain('crambin');
  });

  it('parses ubiquitin including waters as hetero residues', () => {
    const structure = parseCif(readBundled('1UBQ'), '1UBQ');
    const stats = structureStats(structure);
    expect(stats.atoms).toBe(660);
    expect(stats.polymerResidues).toBe(76);
    expect(stats.heteroAtoms).toBeGreaterThan(0);
  });

  it('parses a two-partner complex with distinct chains', () => {
    const structure = parseCif(readBundled('1BRS'), '1BRS');
    // 5153 rows in the file, minus the two altLoc B duplicates.
    expect(structure.atoms.length).toBe(5151);
    const chainIds = structure.chains.map((c) => c.id);
    expect(chainIds).toContain('A');
    expect(chainIds).toContain('D');
  });

  it('reads secondary structure from _struct_conf rather than guessing', () => {
    const structure = parseCif(readBundled('1UBQ'), '1UBQ');
    const helices = structure.residues.filter((r) => r.secondaryStructure === 'helix');
    const sheets = structure.residues.filter((r) => r.secondaryStructure === 'sheet');
    expect(helices.length).toBeGreaterThan(5);
    expect(sheets.length).toBeGreaterThan(5);

    // Explicit records must win: a second pass may not overwrite them.
    const before = structure.residues.map((r) => r.secondaryStructure);
    assignSecondaryStructure(structure);
    expect(structure.residues.map((r) => r.secondaryStructure)).toEqual(before);
  });

  it('keeps only the first model of a multi-model entry', () => {
    const text = [
      'data_MULTI',
      '_entry.id MULTI',
      'loop_',
      '_atom_site.group_PDB',
      '_atom_site.id',
      '_atom_site.type_symbol',
      '_atom_site.label_atom_id',
      '_atom_site.label_comp_id',
      '_atom_site.label_asym_id',
      '_atom_site.label_seq_id',
      '_atom_site.Cartn_x',
      '_atom_site.Cartn_y',
      '_atom_site.Cartn_z',
      '_atom_site.occupancy',
      '_atom_site.B_iso_or_equiv',
      '_atom_site.pdbx_PDB_model_num',
      'ATOM 1 N N ALA A 1 0.0 0.0 0.0 1.00 10.0 1',
      'ATOM 2 C CA ALA A 1 1.5 0.0 0.0 1.00 10.0 1',
      'ATOM 3 N N ALA A 1 9.0 9.0 9.0 1.00 10.0 2',
      'ATOM 4 C CA ALA A 1 9.5 9.0 9.0 1.00 10.0 2',
    ].join('\n');

    const structure = parseCif(text);
    expect(structure.atoms).toHaveLength(2);
    expect(structure.atoms[1].x).toBeCloseTo(1.5);
  });

  it('drops alternate conformers other than A', () => {
    const text = [
      'data_ALT',
      'loop_',
      '_atom_site.group_PDB',
      '_atom_site.id',
      '_atom_site.type_symbol',
      '_atom_site.label_atom_id',
      '_atom_site.label_alt_id',
      '_atom_site.label_comp_id',
      '_atom_site.label_asym_id',
      '_atom_site.label_seq_id',
      '_atom_site.Cartn_x',
      '_atom_site.Cartn_y',
      '_atom_site.Cartn_z',
      'ATOM 1 C CB A SER A 1 0.0 0.0 0.0',
      'ATOM 2 C CB B SER A 1 0.4 0.0 0.0',
      'ATOM 3 O OG . SER A 1 1.4 0.0 0.0',
    ].join('\n');

    const structure = parseCif(text);
    expect(structure.atoms.map((a) => a.name)).toEqual(['CB', 'OG']);
  });
});

describe('parseStructure', () => {
  it('sniffs mmCIF content without relying on the filename', () => {
    const structure = parseStructure(readBundled('1CRN'), 'download', '1CRN');
    expect(structure.atoms.length).toBe(327);
  });
});
