import * as THREE from 'three';
import { elementColor } from '../core/elements';
import type { Bond, Structure } from '../core/types';

const RADIUS = 0.16;
const RADIAL_SEGMENTS = 6;

/**
 * Bonds as instanced cylinders, split at the midpoint so each half takes its
 * atom's colour. One InstancedMesh keeps the whole structure at two draw calls.
 */
export class BondSticks {
  readonly mesh: THREE.InstancedMesh;

  constructor(structure: Structure, bonds: readonly Bond[]) {
    // Unit-height cylinder along +Y so a single quaternion aligns it to a bond.
    const geometry = new THREE.CylinderGeometry(
      RADIUS,
      RADIUS,
      1,
      RADIAL_SEGMENTS,
      1,
      true,
    );
    geometry.translate(0, 0.5, 0);

    const material = new THREE.MeshStandardMaterial({
      roughness: 0.45,
      metalness: 0.05,
      vertexColors: true,
    });

    this.mesh = new THREE.InstancedMesh(geometry, material, bonds.length * 2);
    this.mesh.frustumCulled = false;

    const start = new THREE.Vector3();
    const end = new THREE.Vector3();
    const mid = new THREE.Vector3();
    const direction = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const matrix = new THREE.Matrix4();
    const color = new THREE.Color();

    let instance = 0;
    for (const bond of bonds) {
      const a = structure.atoms[bond.a];
      const b = structure.atoms[bond.b];
      start.set(a.x, a.y, a.z);
      end.set(b.x, b.y, b.z);
      mid.addVectors(start, end).multiplyScalar(0.5);

      for (const [from, to, element] of [
        [start, mid, a.element],
        [end, mid, b.element],
      ] as const) {
        direction.subVectors(to, from);
        const length = direction.length();
        if (length < 1e-4) continue;
        quaternion.setFromUnitVectors(up, direction.clone().normalize());
        scale.set(1, length, 1);
        matrix.compose(from, quaternion, scale);
        this.mesh.setMatrixAt(instance, matrix);
        color.setHex(elementColor(element));
        this.mesh.setColorAt(instance, color);
        instance++;
      }
    }
    this.mesh.count = instance;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
