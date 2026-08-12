import { StructureBuilder, type RawAtom } from './builder';
import { cifInt, cifNumber, cifString, isCifNull, tokenizeCif } from './cifTokenizer';
import { inferElement, normalizeElement } from './elements';
import { applySsRanges, parsePdb } from './pdb';
import type { SecondaryStructure, Structure } from './types';

interface SsRange {
  chainId: string;
  start: number;
  end: number;
  kind: SecondaryStructure;
}

const ATOM_SITE = '_atom_site';
const STRUCT_CONF = '_struct_conf';
const SHEET_RANGE = '_struct_sheet_range';

/**
 * Parses mmCIF (PDBx) into a Structure. mmCIF is the canonical modern format:
 * large assemblies and long chain ids no longer fit the legacy PDB columns, so
 * this is the path that must work for arbitrary RCSB entries.
 *
 * Only the first pdbx_PDB_model_num is kept, and only the primary altloc.
 */
export function parseCif(text: string, fallbackId = 'UNKNOWN'): Structure {
  const items = new Map<string, string>();
  const ssRanges: SsRange[] = [];
  const atoms: RawAtom[] = [];
  let dataBlockId = fallbackId;
  let firstModel: number | null = null;

  let loopTags: string[] | null = null;
  let loopValues: string[] = [];
  let pendingTag: string | null = null;

  const flushLoopRow = (): void => {
    if (!loopTags || loopValues.length !== loopTags.length) return;
    const row = new Map<string, string>();
    for (let i = 0; i < loopTags.length; i++) row.set(loopTags[i], loopValues[i]);
    loopValues = [];

    const category = loopTags[0].split('.')[0];
    if (category === ATOM_SITE) {
      const model = cifInt(row.get('_atom_site.pdbx_pdb_model_num') ?? '1', 1);
      if (firstModel === null) firstModel = model;
      if (model !== firstModel) return;
      const atom = atomFromRow(row);
      if (atom) atoms.push(atom);
    } else if (category === STRUCT_CONF) {
      const range = confRange(row);
      if (range) ssRanges.push(range);
    } else if (category === SHEET_RANGE) {
      const range = sheetRange(row);
      if (range) ssRanges.push(range);
    }
  };

  for (const token of tokenizeCif(text)) {
    switch (token.kind) {
      case 'data':
        dataBlockId = token.name || dataBlockId;
        break;
      case 'loop':
        loopTags = [];
        loopValues = [];
        pendingTag = null;
        break;
      case 'tag':
        if (loopTags !== null && loopValues.length === 0) {
          loopTags.push(token.name);
        } else {
          loopTags = null;
          pendingTag = token.name;
        }
        break;
      case 'value':
        if (pendingTag !== null) {
          items.set(pendingTag, token.value);
          pendingTag = null;
        } else if (loopTags !== null && loopTags.length > 0) {
          loopValues.push(token.value);
          if (loopValues.length === loopTags.length) flushLoopRow();
        }
        break;
      case 'save':
        loopTags = null;
        pendingTag = null;
        break;
    }
  }

  const id = cifString(items.get('_entry.id') ?? '') || dataBlockId;
  const builder = new StructureBuilder(id, '');
  for (const atom of atoms) builder.add(atom);

  const structure: Structure = {
    ...builder.build(),
    id,
    title: cifString(items.get('_struct.title') ?? '').replace(/\s+/g, ' ').trim(),
  };
  applySsRanges(structure, ssRanges);
  return structure;
}

function atomFromRow(row: Map<string, string>): RawAtom | null {
  const x = cifNumber(row.get('_atom_site.cartn_x') ?? '', NaN);
  const y = cifNumber(row.get('_atom_site.cartn_y') ?? '', NaN);
  const z = cifNumber(row.get('_atom_site.cartn_z') ?? '', NaN);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;

  const altLocRaw = row.get('_atom_site.label_alt_id') ?? '.';
  const altLoc = isCifNull(altLocRaw) ? '' : altLocRaw;
  if (altLoc !== '' && altLoc !== 'A') return null;

  const name = cifString(
    row.get('_atom_site.auth_atom_id') ?? row.get('_atom_site.label_atom_id') ?? '',
  );
  const elementRaw = cifString(row.get('_atom_site.type_symbol') ?? '');
  const element = elementRaw !== '' ? normalizeElement(elementRaw) : inferElement(name);

  const residueName = cifString(
    row.get('_atom_site.auth_comp_id') ?? row.get('_atom_site.label_comp_id') ?? '',
  );
  const chainId = cifString(
    row.get('_atom_site.auth_asym_id') ?? row.get('_atom_site.label_asym_id') ?? '',
  ) || 'A';
  const seqRaw = row.get('_atom_site.auth_seq_id') ?? row.get('_atom_site.label_seq_id') ?? '';
  const insertion = row.get('_atom_site.pdbx_pdb_ins_code') ?? '.';

  return {
    serial: cifInt(row.get('_atom_site.id') ?? '', 0),
    name,
    element,
    altLoc,
    x,
    y,
    z,
    occupancy: cifNumber(row.get('_atom_site.occupancy') ?? '', 1),
    bFactor: cifNumber(row.get('_atom_site.b_iso_or_equiv') ?? '', 0),
    hetero: (row.get('_atom_site.group_pdb') ?? 'ATOM').toUpperCase() === 'HETATM',
    chainId,
    residueName,
    residueSeq: cifInt(seqRaw, 0),
    insertionCode: isCifNull(insertion) ? '' : insertion,
  };
}

function confRange(row: Map<string, string>): SsRange | null {
  const type = (row.get('_struct_conf.conf_type_id') ?? '').toUpperCase();
  if (!type.includes('HELX')) return null;
  const chainId = cifString(
    row.get('_struct_conf.beg_auth_asym_id') ??
      row.get('_struct_conf.beg_label_asym_id') ??
      '',
  );
  const start = cifInt(
    row.get('_struct_conf.beg_auth_seq_id') ?? row.get('_struct_conf.beg_label_seq_id') ?? '',
    NaN,
  );
  const end = cifInt(
    row.get('_struct_conf.end_auth_seq_id') ?? row.get('_struct_conf.end_label_seq_id') ?? '',
    NaN,
  );
  if (!chainId || !Number.isFinite(start) || !Number.isFinite(end)) return null;
  return { chainId, start, end, kind: 'helix' };
}

function sheetRange(row: Map<string, string>): SsRange | null {
  const chainId = cifString(
    row.get('_struct_sheet_range.beg_auth_asym_id') ??
      row.get('_struct_sheet_range.beg_label_asym_id') ??
      '',
  );
  const start = cifInt(
    row.get('_struct_sheet_range.beg_auth_seq_id') ??
      row.get('_struct_sheet_range.beg_label_seq_id') ??
      '',
    NaN,
  );
  const end = cifInt(
    row.get('_struct_sheet_range.end_auth_seq_id') ??
      row.get('_struct_sheet_range.end_label_seq_id') ??
      '',
    NaN,
  );
  if (!chainId || !Number.isFinite(start) || !Number.isFinite(end)) return null;
  return { chainId, start, end, kind: 'sheet' };
}

/** Dispatches on file extension / content sniffing. */
export function parseStructure(
  text: string,
  filename = '',
  fallbackId = 'UNKNOWN',
): Structure {
  const lower = filename.toLowerCase();
  const looksCif = lower.endsWith('.cif') || lower.endsWith('.mmcif') ||
    /^\s*data_/m.test(text.slice(0, 4096));
  return looksCif ? parseCif(text, fallbackId) : parsePdb(text, fallbackId);
}
