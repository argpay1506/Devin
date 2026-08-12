import { parseCif, parseStructure } from '../core/cif';
import { assignSecondaryStructure } from '../core/secondaryStructure';
import type { Structure } from '../core/types';
import { BUNDLED_STRUCTURES } from './library';

const RCSB_CIF = (id: string) => `https://files.rcsb.org/download/${id.toUpperCase()}.cif`;
const ALPHAFOLD_API = (accession: string) =>
  `https://alphafold.ebi.ac.uk/api/prediction/${accession.toUpperCase()}`;

const memoryCache = new Map<string, Structure>();

export class StructureFetchError extends Error {}

export function isValidPdbId(id: string): boolean {
  return /^[0-9][A-Za-z0-9]{3}$/.test(id.trim());
}

/**
 * Loads a structure by PDB id: bundled copy first, then the in-memory cache,
 * then RCSB. Secondary structure is assigned geometrically when the entry has no
 * HELIX/_struct_conf records (common for predicted and CA-only models).
 */
export async function loadPdbId(id: string): Promise<Structure> {
  const key = id.trim().toUpperCase();
  if (!isValidPdbId(key)) {
    throw new StructureFetchError(
      `"${id}" is not a PDB id. Ids are 4 characters starting with a digit, e.g. 1UBQ.`,
    );
  }

  const cached = memoryCache.get(key);
  if (cached) return cached;

  const bundled = BUNDLED_STRUCTURES[key];
  if (bundled) {
    const structure = finalize(parseCif(bundled, key));
    memoryCache.set(key, structure);
    return structure;
  }

  let response: Response;
  try {
    response = await fetch(RCSB_CIF(key));
  } catch (cause) {
    throw new StructureFetchError(
      `Could not reach RCSB. Offline? The bundled library still works. (${String(cause)})`,
    );
  }
  if (response.status === 404) {
    throw new StructureFetchError(`RCSB has no entry ${key}.`);
  }
  if (!response.ok) {
    throw new StructureFetchError(`RCSB returned ${response.status} for ${key}.`);
  }

  const structure = finalize(parseCif(await response.text(), key));
  if (structure.atoms.length === 0) {
    throw new StructureFetchError(`Entry ${key} parsed to zero atoms.`);
  }
  memoryCache.set(key, structure);
  return structure;
}

/** Loads a predicted model from AlphaFold DB by UniProt accession. */
export async function loadAlphaFold(accession: string): Promise<Structure> {
  const key = `AF:${accession.trim().toUpperCase()}`;
  const cached = memoryCache.get(key);
  if (cached) return cached;

  const metaResponse = await fetch(ALPHAFOLD_API(accession));
  if (!metaResponse.ok) {
    throw new StructureFetchError(
      `AlphaFold DB has no prediction for ${accession} (${metaResponse.status}).`,
    );
  }
  const entries = (await metaResponse.json()) as Array<{ cifUrl?: string; pdbUrl?: string }>;
  const url = entries[0]?.cifUrl ?? entries[0]?.pdbUrl;
  if (!url) throw new StructureFetchError(`AlphaFold response for ${accession} had no model URL.`);

  const modelResponse = await fetch(url);
  if (!modelResponse.ok) {
    throw new StructureFetchError(`Could not download the AlphaFold model (${modelResponse.status}).`);
  }
  const structure = finalize(parseStructure(await modelResponse.text(), url, accession));
  memoryCache.set(key, structure);
  return structure;
}

export function parseUploadedFile(text: string, filename: string): Structure {
  const id = filename.replace(/\.[^.]+$/, '').toUpperCase();
  return finalize(parseStructure(text, filename, id));
}

function finalize(structure: Structure): Structure {
  assignSecondaryStructure(structure);
  return structure;
}
