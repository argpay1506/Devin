import * as THREE from 'three';
import type { InteractionResult } from '../core/interactions';
import type { Structure } from '../core/types';

/**
 * Interface annotations: dashed cyan hydrogen bonds and red clash markers.
 * Kept as two objects with rebuildable geometry so slider-driven updates never
 * allocate new materials.
 */
export class InteractionOverlay {
  readonly group = new THREE.Group();
  private readonly hbondLines: THREE.LineSegments;
  private readonly clashPoints: THREE.Points;

  constructor() {
    const hbondGeometry = new THREE.BufferGeometry();
    hbondGeometry.setAttribute('position', new THREE.Float32BufferAttribute([], 3));
    const hbondMaterial = new THREE.LineDashedMaterial({
      color: 0x4ff0ff,
      dashSize: 0.28,
      gapSize: 0.18,
      linewidth: 1,
      transparent: true,
      opacity: 0.95,
    });
    this.hbondLines = new THREE.LineSegments(hbondGeometry, hbondMaterial);
    this.hbondLines.frustumCulled = false;

    const clashGeometry = new THREE.BufferGeometry();
    clashGeometry.setAttribute('position', new THREE.Float32BufferAttribute([], 3));
    const clashMaterial = new THREE.PointsMaterial({
      color: 0xff2d2d,
      size: 1.4,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    });
    this.clashPoints = new THREE.Points(clashGeometry, clashMaterial);
    this.clashPoints.frustumCulled = false;

    this.group.add(this.hbondLines, this.clashPoints);
  }

  update(structure: Structure, result: InteractionResult): void {
    const hbondPositions: number[] = [];
    for (const bond of result.hydrogenBonds) {
      const a = structure.atoms[bond.donor];
      const b = structure.atoms[bond.acceptor];
      hbondPositions.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
    this.replacePositions(this.hbondLines.geometry, hbondPositions);
    // Dashes are computed from cumulative line distance, so this must run after
    // every geometry swap or the dash pattern collapses.
    this.hbondLines.computeLineDistances();

    const clashPositions: number[] = [];
    for (const clash of result.clashes) {
      const a = structure.atoms[clash.a];
      const b = structure.atoms[clash.b];
      clashPositions.push((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    }
    this.replacePositions(this.clashPoints.geometry, clashPositions);
  }

  clear(): void {
    this.replacePositions(this.hbondLines.geometry, []);
    this.hbondLines.computeLineDistances();
    this.replacePositions(this.clashPoints.geometry, []);
  }

  setVisible(visible: boolean): void {
    this.group.visible = visible;
  }

  private replacePositions(geometry: THREE.BufferGeometry, values: number[]): void {
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(values, 3));
    geometry.computeBoundingSphere();
  }

  dispose(): void {
    this.hbondLines.geometry.dispose();
    (this.hbondLines.material as THREE.Material).dispose();
    this.clashPoints.geometry.dispose();
    (this.clashPoints.material as THREE.Material).dispose();
  }
}
