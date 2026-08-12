import bundled1BRS from './bundled/1BRS.cif?raw';
import bundled1CRN from './bundled/1CRN.cif?raw';
import bundled1UBQ from './bundled/1UBQ.cif?raw';
import bundled4INS from './bundled/4INS.cif?raw';

export interface LibraryEntry {
  pdbId: string;
  name: string;
  blurb: string;
  /** Preset docking partners, when the entry is a complex worth pulling apart. */
  docking?: { a: string; b: string };
}

/**
 * Offline bundle. A classroom on bad Wi-Fi is the normal case, not the edge
 * case, so the flagship structures ship with the app instead of being fetched.
 */
export const BUNDLED_STRUCTURES: Record<string, string> = {
  '1CRN': bundled1CRN,
  '1UBQ': bundled1UBQ,
  '4INS': bundled4INS,
  '1BRS': bundled1BRS,
};

export const BUNDLED_LIBRARY: LibraryEntry[] = [
  {
    pdbId: '1CRN',
    name: 'Crambin',
    blurb: '46 residues, atomic resolution. The smallest useful teaching protein.',
  },
  {
    pdbId: '1UBQ',
    name: 'Ubiquitin',
    blurb: 'The beta-grasp fold: one helix packed against a five-strand sheet.',
  },
  {
    pdbId: '4INS',
    name: 'Insulin',
    blurb: 'Two chains held by disulfides; the classic hormone structure.',
  },
  {
    pdbId: '1BRS',
    name: 'Barnase-Barstar',
    blurb: 'A textbook high-affinity protein interface, ideal for the docking sandbox.',
    docking: { a: 'A', b: 'D' },
  },
];

/** Fetched on demand; the "greatest hits" the importer suggests. */
export const REMOTE_LIBRARY: LibraryEntry[] = [
  { pdbId: '1GFL', name: 'Green fluorescent protein', blurb: 'Beta-barrel with the chromophore threaded through its axis.' },
  { pdbId: '1HHO', name: 'Hemoglobin (alpha/beta)', blurb: 'Heme-bound globin; cooperative oxygen binding.' },
  { pdbId: '4OO8', name: 'CRISPR-Cas9 + sgRNA + DNA', blurb: 'The gene-editing complex, with the R-loop resolved.' },
  { pdbId: '6VXX', name: 'SARS-CoV-2 spike (closed)', blurb: 'Trimeric spike glycoprotein, prefusion.' },
  { pdbId: '6M0J', name: 'Spike RBD + ACE2', blurb: 'The receptor-binding interface behind the docking activity.', docking: { a: 'A', b: 'E' } },
  { pdbId: '1BNA', name: 'B-DNA dodecamer', blurb: 'Canonical double helix, the CRISPR simulator substrate.' },
];
