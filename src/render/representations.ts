import * as THREE from 'three';
import { elementColor, vdwRadius } from '../core/elements';
import type { Structure } from '../core/types';
import type { SphereData } from './impostorSpheres';

export type Coloring = 'element' | 'chain' | 'secondaryStructure' | 'bFactor';
export type SphereStyle = 'spacefill' | 'ballAndStick' | 'points';

const CHAIN_COLORS = [
  0x4f9cff, 0xff7b4f, 0x64d97b, 0xc77bff, 0xffd24f, 0x4fe3d9, 0xff6fae, 0x9ad04f,
];

const SS_COLORS = {
  helix: 0xff4f6d,
  sheet: 0xffc857,
  coil: 0x6fe3d0,
} as const;

const STYLE_SCALE: Record<SphereStyle, number> = {
  spacefill: 1.0,
  ballAndStick: 0.32,
  points: 0.14,
};

export interface SphereOptions {
  coloring: Coloring;
  style: SphereStyle;
  /** Atom indices to include; defaults to every atom. */
  indices?: readonly number[];
  /** Multiplies the final radius, used for emphasis and LOD. */
  radiusScale?: number;
}

export function buildSphereData(structure: Structure, options: SphereOptions): SphereData {
  const indices = options.indices ?? structure.atoms.map((_, i) => i);
  const centers = new Float32Array(indices.length * 3);
  const radii = new Float32Array(indices.length);
  const colors = new Float32Array(indices.length * 3);
  const scale = STYLE_SCALE[options.style] * (options.radiusScale ?? 1);
  const color = new THREE.Color();
  const range = bFactorRange(structure);

  for (let i = 0; i < indices.length; i++) {
    const atom = structure.atoms[indices[i]];
    centers[i * 3] = atom.x;
    centers[i * 3 + 1] = atom.y;
    centers[i * 3 + 2] = atom.z;
    radii[i] = vdwRadius(atom.element) * scale;

    color.setHex(atomColor(structure, indices[i], options.coloring, range));
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  return { centers, radii, colors };
}

function atomColor(
  structure: Structure,
  atomIndex: number,
  coloring: Coloring,
  range: { min: number; max: number },
): number {
  const atom = structure.atoms[atomIndex];
  const residue = structure.residues[atom.residueIndex];

  switch (coloring) {
    case 'element':
      return elementColor(atom.element);
    case 'chain':
      return CHAIN_COLORS[residue.chainIndex % CHAIN_COLORS.length];
    case 'secondaryStructure':
      return residue.hetero ? 0xb0b0b0 : SS_COLORS[residue.secondaryStructure];
    case 'bFactor': {
      const span = range.max - range.min || 1;
      const t = Math.min(1, Math.max(0, (atom.bFactor - range.min) / span));
      // Blue (rigid) to red (mobile); doubles as pLDDT colouring for predicted
      // models, where the same column carries the confidence score.
      return new THREE.Color().setHSL((1 - t) * 0.66, 0.85, 0.55).getHex();
    }
  }
}

function bFactorRange(structure: Structure): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const atom of structure.atoms) {
    if (atom.bFactor < min) min = atom.bFactor;
    if (atom.bFactor > max) max = atom.bFactor;
  }
  if (!Number.isFinite(min)) return { min: 0, max: 1 };
  return { min, max };
}

/** Non-solvent hetero atoms: ligands, cofactors, metals — worth always showing. */
export function ligandAtomIndices(structure: Structure): number[] {
  const indices: number[] = [];
  for (const residue of structure.residues) {
    if (!residue.hetero) continue;
    if (isSolventName(residue.name)) continue;
    indices.push(...residue.atomIndices);
  }
  return indices;
}

function isSolventName(name: string): boolean {
  const upper = name.toUpperCase();
  return upper === 'HOH' || upper === 'DOD' || upper === 'WAT';
}

export function sideChainAtomIndices(structure: Structure): number[] {
  const BACKBONE = new Set(['N', 'CA', 'C', 'O', 'OXT']);
  const indices: number[] = [];
  for (const atom of structure.atoms) {
    if (atom.element === 'H') continue;
    const residue = structure.residues[atom.residueIndex];
    if (residue.hetero) continue;
    if (!BACKBONE.has(atom.name)) indices.push(atom.index);
  }
  return indices;
}
