import { StructureBuilder, type RawAtom } from './builder';
import { inferElement, normalizeElement } from './elements';
import type { SecondaryStructure, Structure } from './types';

interface SsRange {
  chainId: string;
  start: number;
  end: number;
  kind: SecondaryStructure;
}

/**
 * Parses the legacy fixed-column PDB format. Only the first MODEL is kept:
 * NMR ensembles would otherwise render as a blur of overlapping copies.
 */
export function parsePdb(text: string, fallbackId = 'UNKNOWN'): Structure {
  const lines = text.split(/\r?\n/);
  let id = fallbackId;
  const titleParts: string[] = [];
  const ssRanges: SsRange[] = [];
  let inLaterModel = false;

  const builder = new StructureBuilder(id, '');
  const pending: RawAtom[] = [];

  for (const line of lines) {
    const record = line.slice(0, 6).trim();

    if (record === 'HEADER') {
      const code = line.slice(62, 66).trim();
      if (code) id = code;
      continue;
    }
    if (record === 'TITLE') {
      titleParts.push(line.slice(10).trim());
      continue;
    }
    if (record === 'HELIX') {
      const range = parseHelix(line);
      if (range) ssRanges.push(range);
      continue;
    }
    if (record === 'SHEET') {
      const range = parseSheet(line);
      if (range) ssRanges.push(range);
      continue;
    }
    if (record === 'MODEL') {
      const serial = parseInt(line.slice(10, 14).trim(), 10);
      inLaterModel = Number.isFinite(serial) && serial > 1;
      continue;
    }
    if (record === 'ENDMDL') {
      inLaterModel = true;
      continue;
    }
    if (record !== 'ATOM' && record !== 'HETATM') continue;
    if (inLaterModel) continue;

    const atom = parseAtomLine(line, record === 'HETATM');
    if (atom) pending.push(atom);
  }

  for (const atom of pending) builder.add(atom);
  const structure = builder.build();
  const titled: Structure = {
    ...structure,
    id,
    title: normalizeTitle(titleParts.join(' ')),
  };
  applySsRanges(titled, ssRanges);
  return titled;
}

function parseAtomLine(line: string, hetero: boolean): RawAtom | null {
  if (line.length < 54) return null;
  const x = parseFloat(line.slice(30, 38));
  const y = parseFloat(line.slice(38, 46));
  const z = parseFloat(line.slice(46, 54));
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;

  const altLoc = line.slice(16, 17).trim();
  // Keep only the primary conformer; alternates duplicate geometry.
  if (altLoc !== '' && altLoc !== 'A') return null;

  const name = line.slice(12, 16).trim();
  const elementColumn = line.slice(76, 78).trim();
  const element = elementColumn !== ''
    ? normalizeElement(elementColumn)
    : inferElement(name, line.slice(12, 13));

  const occupancy = parseFloat(line.slice(54, 60));
  const bFactor = parseFloat(line.slice(60, 66));

  return {
    serial: parseInt(line.slice(6, 11).trim(), 10) || 0,
    name,
    element,
    altLoc,
    x,
    y,
    z,
    occupancy: Number.isFinite(occupancy) ? occupancy : 1,
    bFactor: Number.isFinite(bFactor) ? bFactor : 0,
    hetero,
    chainId: line.slice(21, 22).trim() || 'A',
    residueName: line.slice(17, 20).trim(),
    residueSeq: parseInt(line.slice(22, 26).trim(), 10) || 0,
    insertionCode: line.slice(26, 27).trim(),
  };
}

function parseHelix(line: string): SsRange | null {
  if (line.length < 38) return null;
  const chainId = line.slice(19, 20).trim() || 'A';
  const start = parseInt(line.slice(21, 25).trim(), 10);
  const end = parseInt(line.slice(33, 37).trim(), 10);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return { chainId, start, end, kind: 'helix' };
}

function parseSheet(line: string): SsRange | null {
  if (line.length < 38) return null;
  const chainId = line.slice(21, 22).trim() || 'A';
  const start = parseInt(line.slice(22, 26).trim(), 10);
  const end = parseInt(line.slice(33, 37).trim(), 10);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return { chainId, start, end, kind: 'sheet' };
}

export function applySsRanges(
  structure: Structure,
  ranges: readonly SsRange[],
): void {
  if (ranges.length === 0) return;
  const byChainId = new Map<string, number>();
  for (const chain of structure.chains) byChainId.set(chain.id, chain.index);

  for (const range of ranges) {
    const chainIndex = byChainId.get(range.chainId);
    if (chainIndex === undefined) continue;
    for (const residueIndex of structure.chains[chainIndex].residueIndices) {
      const residue = structure.residues[residueIndex];
      if (residue.seq >= range.start && residue.seq <= range.end) {
        residue.secondaryStructure = range.kind;
      }
    }
  }
}

function normalizeTitle(title: string): string {
  return title.replace(/\s+/g, ' ').trim();
}
