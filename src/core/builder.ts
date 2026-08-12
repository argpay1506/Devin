import type { Atom, Chain, Residue, SecondaryStructure, Structure } from './types';
import { isPolymer } from './types';

export interface RawAtom {
  serial: number;
  name: string;
  element: string;
  altLoc: string;
  x: number;
  y: number;
  z: number;
  occupancy: number;
  bFactor: number;
  hetero: boolean;
  chainId: string;
  residueName: string;
  residueSeq: number;
  insertionCode: string;
}

/**
 * Accumulates flat atom records into a Structure, grouping atoms into residues
 * and chains. Residue identity is (chain, seq, insertion code, name), which
 * keeps microheterogeneity and insertion-coded antibody numbering intact.
 */
export class StructureBuilder {
  private readonly atoms: Atom[] = [];
  private readonly residues: Residue[] = [];
  private readonly chains: Chain[] = [];
  private readonly chainByKey = new Map<string, number>();
  private readonly residueByKey = new Map<string, number>();

  constructor(
    private readonly id: string,
    private readonly title: string = '',
  ) {}

  add(raw: RawAtom): void {
    const chainIndex = this.chainIndex(raw.chainId);
    const residueIndex = this.residueIndex(chainIndex, raw);
    const atom: Atom = {
      index: this.atoms.length,
      serial: raw.serial,
      name: raw.name,
      element: raw.element,
      altLoc: raw.altLoc,
      x: raw.x,
      y: raw.y,
      z: raw.z,
      occupancy: raw.occupancy,
      bFactor: raw.bFactor,
      hetero: raw.hetero,
      residueIndex,
    };
    this.atoms.push(atom);
    this.residues[residueIndex].atomIndices.push(atom.index);
  }

  build(): Structure {
    return {
      id: this.id,
      title: this.title,
      atoms: this.atoms,
      residues: this.residues,
      chains: this.chains,
    };
  }

  get atomCount(): number {
    return this.atoms.length;
  }

  private chainIndex(chainId: string): number {
    const existing = this.chainByKey.get(chainId);
    if (existing !== undefined) return existing;
    const index = this.chains.length;
    this.chains.push({ index, id: chainId, residueIndices: [] });
    this.chainByKey.set(chainId, index);
    return index;
  }

  private residueIndex(chainIndex: number, raw: RawAtom): number {
    const key = `${chainIndex}|${raw.residueSeq}|${raw.insertionCode}|${raw.residueName}`;
    const existing = this.residueByKey.get(key);
    if (existing !== undefined) return existing;
    const index = this.residues.length;
    const secondaryStructure: SecondaryStructure = 'coil';
    this.residues.push({
      index,
      name: raw.residueName,
      seq: raw.residueSeq,
      insertionCode: raw.insertionCode,
      chainIndex,
      atomIndices: [],
      secondaryStructure,
      hetero: raw.hetero || !isPolymer(raw.residueName),
    });
    this.residueByKey.set(key, index);
    this.chains[chainIndex].residueIndices.push(index);
    return index;
  }
}
