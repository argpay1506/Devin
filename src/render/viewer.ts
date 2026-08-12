import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { inferBonds } from '../core/bonds';
import {
  chainSelection,
  scoreInterface,
  translateSelection,
  type InteractionResult,
} from '../core/interactions';
import { subStructure } from '../core/subset';
import { boundingSphere, type Structure } from '../core/types';
import { BondSticks } from './bondSticks';
import { buildBackboneTube, buildCartoon } from './cartoon';
import { ImpostorSpheres } from './impostorSpheres';
import { DETAIL_LABELS, LodController, type DetailLevel } from './lod';
import { InteractionOverlay } from './overlays';
import {
  buildSphereData,
  ligandAtomIndices,
  sideChainAtomIndices,
  type Coloring,
} from './representations';

/** Above this atom count, bond inference for sticks is skipped as too costly. */
const STICK_ATOM_LIMIT = 30_000;

export interface ViewerStats {
  structureId: string;
  title: string;
  atoms: number;
  residues: number;
  chains: number;
  fps: number;
  frameTimeMs: number;
  detail: string;
  governorEngaged: boolean;
  triangles: number;
  drawCalls: number;
}

export interface DockingState {
  chainA: string;
  chainB: string;
  /** Separation along the interface axis, in angstrom. */
  separation: number;
}

export type StatsListener = (stats: ViewerStats) => void;
export type ScoreListener = (result: InteractionResult | null) => void;

export class Viewer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly root = new THREE.Group();
  private readonly partnerGroup = new THREE.Group();
  private readonly overlay = new InteractionOverlay();
  private readonly lod: LodController;

  private structure: Structure | null = null;
  private disposables: Array<{ dispose(): void }> = [];
  private cartoon: THREE.Object3D | null = null;
  private tube: THREE.Object3D | null = null;
  private sideChains: ImpostorSpheres | null = null;
  private ligands: ImpostorSpheres | null = null;
  private partnerCartoon: THREE.Object3D | null = null;
  private partnerSpheres: ImpostorSpheres | null = null;

  private coloring: Coloring = 'secondaryStructure';
  private autoRotate = false;
  private lastFrame = performance.now();
  private fpsEma = 60;
  private statsListener: StatsListener | null = null;
  private scoreListener: ScoreListener | null = null;
  private docking: DockingState | null = null;
  private scoreDirty = false;
  private lastScoreAt = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setClearColor(0x0a0f18, 1);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.5, 5000);
    this.camera.position.set(0, 0, 80);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;

    this.scene.add(this.root);
    this.root.add(this.partnerGroup);
    // The overlay lives under root so it inherits the centring translation and
    // auto-rotation and can never drift away from the atoms it annotates.
    this.root.add(this.overlay.group);
    this.addLights();

    this.lod = new LodController({
      setCartoonVisible: (v) => {
        if (this.cartoon) this.cartoon.visible = v;
        if (this.partnerCartoon) this.partnerCartoon.visible = v;
      },
      setTubeVisible: (v) => {
        if (this.tube) this.tube.visible = v;
      },
      setSideChainsVisible: (v) => {
        if (this.sideChains) this.sideChains.mesh.visible = v;
      },
      setLigandsVisible: (v) => {
        if (this.ligands) this.ligands.mesh.visible = v;
      },
    });

    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.renderer.setAnimationLoop(() => this.frame());
  }

  onStats(listener: StatsListener): void {
    this.statsListener = listener;
  }

  onScore(listener: ScoreListener): void {
    this.scoreListener = listener;
  }

  setColoring(coloring: Coloring): void {
    this.coloring = coloring;
    if (this.structure) this.load(this.structure, this.docking);
  }

  setAutoRotate(enabled: boolean): void {
    this.autoRotate = enabled;
  }

  forceDetail(level: DetailLevel | 'auto'): void {
    if (level !== 'auto') this.lod.force(level);
  }

  setOverlayVisible(visible: boolean): void {
    this.overlay.setVisible(visible);
  }

  /** Builds every representation for `structure`, optionally in docking mode. */
  load(structure: Structure, docking: DockingState | null = null): void {
    this.clear();
    this.structure = structure;
    this.docking = docking;

    const sphere = boundingSphere(structure.atoms);
    this.root.position.set(-sphere.center[0], -sphere.center[1], -sphere.center[2]);
    this.partnerGroup.position.set(0, 0, 0);

    if (docking) this.buildDockingScene(structure, docking);
    else this.buildExploreScene(structure);

    this.frameCamera(sphere.radius);
    this.scoreDirty = docking !== null;
  }

  private buildExploreScene(structure: Structure): void {
    const cartoon = buildCartoon(
      structure,
      this.coloring === 'chain' ? 'chain' : 'secondaryStructure',
    );
    if (cartoon) {
      this.cartoon = cartoon;
      this.root.add(cartoon);
      this.track(cartoon.geometry, cartoon.material as THREE.Material);
    }

    const tube = buildBackboneTube(structure);
    if (tube) {
      tube.visible = false;
      this.tube = tube;
      this.root.add(tube);
      this.track(tube.geometry, tube.material as THREE.Material);
    }

    const sideChainIndices = sideChainAtomIndices(structure);
    if (sideChainIndices.length > 0) {
      this.sideChains = new ImpostorSpheres(
        buildSphereData(structure, {
          coloring: this.coloring,
          style: 'ballAndStick',
          indices: sideChainIndices,
        }),
      );
      this.root.add(this.sideChains.mesh);
      this.disposables.push(this.sideChains);
    }

    const ligandIndices = ligandAtomIndices(structure);
    if (ligandIndices.length > 0) {
      this.ligands = new ImpostorSpheres(
        buildSphereData(structure, {
          coloring: 'element',
          style: 'ballAndStick',
          indices: ligandIndices,
          radiusScale: 1.4,
        }),
      );
      this.root.add(this.ligands.mesh);
      this.disposables.push(this.ligands);

      if (structure.atoms.length < STICK_ATOM_LIMIT) {
        const ligandOnly = subStructure(structure, ligandIndices);
        const sticks = new BondSticks(ligandOnly, inferBonds(ligandOnly));
        this.root.add(sticks.mesh);
        this.disposables.push(sticks);
      }
    }
  }

  private buildDockingScene(structure: Structure, docking: DockingState): void {
    const a = chainSelection(structure, docking.chainA);
    const b = chainSelection(structure, docking.chainB);
    if (a.indices.length === 0 || b.indices.length === 0) {
      this.buildExploreScene(structure);
      return;
    }

    const partA = subStructure(structure, a.indices, `${structure.id}:${docking.chainA}`);
    const partB = subStructure(structure, b.indices, `${structure.id}:${docking.chainB}`);

    const cartoonA = buildCartoon(partA, 'chain');
    if (cartoonA) {
      this.cartoon = cartoonA;
      this.root.add(cartoonA);
      this.track(cartoonA.geometry, cartoonA.material as THREE.Material);
    }

    const cartoonB = buildCartoon(partB, 'secondaryStructure');
    if (cartoonB) {
      this.partnerCartoon = cartoonB;
      this.partnerGroup.add(cartoonB);
      this.track(cartoonB.geometry, cartoonB.material as THREE.Material);
    }

    this.sideChains = new ImpostorSpheres(
      buildSphereData(partA, {
        coloring: 'element',
        style: 'points',
        indices: sideChainAtomIndices(partA),
      }),
    );
    this.root.add(this.sideChains.mesh);
    this.disposables.push(this.sideChains);

    this.partnerSpheres = new ImpostorSpheres(
      buildSphereData(partB, {
        coloring: 'element',
        style: 'points',
        indices: sideChainAtomIndices(partB),
      }),
    );
    this.partnerGroup.add(this.partnerSpheres.mesh);
    this.disposables.push(this.partnerSpheres);

    this.applySeparation(docking.separation);
  }

  /** Moves the mobile partner along the centre-to-centre axis. */
  setSeparation(separation: number): void {
    if (!this.docking) return;
    this.docking = { ...this.docking, separation };
    this.applySeparation(separation);
    this.scoreDirty = true;
  }

  private applySeparation(separation: number): void {
    if (!this.structure || !this.docking) return;
    const axis = this.interfaceAxis();
    this.partnerGroup.position.copy(axis.clone().multiplyScalar(separation));
  }

  private interfaceAxis(): THREE.Vector3 {
    if (!this.structure || !this.docking) return new THREE.Vector3(1, 0, 0);
    const a = chainSelection(this.structure, this.docking.chainA);
    const b = chainSelection(this.structure, this.docking.chainB);
    const centerA = this.selectionCenter(a.indices);
    const centerB = this.selectionCenter(b.indices);
    const axis = centerB.sub(centerA);
    return axis.lengthSq() < 1e-6 ? new THREE.Vector3(1, 0, 0) : axis.normalize();
  }

  private selectionCenter(indices: readonly number[]): THREE.Vector3 {
    const center = new THREE.Vector3();
    if (!this.structure || indices.length === 0) return center;
    for (const i of indices) {
      const atom = this.structure.atoms[i];
      center.x += atom.x;
      center.y += atom.y;
      center.z += atom.z;
    }
    return center.divideScalar(indices.length);
  }

  private recomputeScore(): void {
    if (!this.structure || !this.docking) {
      this.scoreListener?.(null);
      return;
    }
    const a = chainSelection(this.structure, this.docking.chainA);
    const b = chainSelection(this.structure, this.docking.chainB);
    if (a.indices.length === 0 || b.indices.length === 0) {
      this.scoreListener?.(null);
      return;
    }

    const axis = this.interfaceAxis();
    const offset: [number, number, number] = [
      axis.x * this.docking.separation,
      axis.y * this.docking.separation,
      axis.z * this.docking.separation,
    ];
    const posed = translateSelection(this.structure, b.indices, offset);
    const result = scoreInterface(posed, a.indices, b.indices);

    this.overlay.update(posed, result);
    this.scoreListener?.(result);
  }

  private frame(): void {
    const now = performance.now();
    const frameTime = now - this.lastFrame;
    this.lastFrame = now;
    this.fpsEma = this.fpsEma * 0.9 + (1000 / Math.max(frameTime, 1e-3)) * 0.1;

    if (this.autoRotate) this.root.rotation.y += 0.004;
    this.controls.update();

    if (this.structure) {
      const sphere = boundingSphere(this.structure.atoms);
      const distance = this.camera.position.length();
      this.lod.update(distance, sphere.radius, this.structure.atoms.length, frameTime);
    }

    // Rescoring runs off the render loop at a fixed rate: the scorer is the one
    // O(interface) CPU cost per interaction and must not gate the frame.
    if (this.scoreDirty && now - this.lastScoreAt > 66) {
      this.scoreDirty = false;
      this.lastScoreAt = now;
      this.recomputeScore();
    }

    this.renderer.render(this.scene, this.camera);
    this.emitStats();
  }

  private emitStats(): void {
    if (!this.statsListener || !this.structure) return;
    const info = this.renderer.info;
    this.statsListener({
      structureId: this.structure.id,
      title: this.structure.title,
      atoms: this.structure.atoms.length,
      residues: this.structure.residues.length,
      chains: this.structure.chains.length,
      fps: this.fpsEma,
      frameTimeMs: this.lod.smoothedFrameTimeMs,
      detail: DETAIL_LABELS[this.lod.currentLevel],
      governorEngaged: this.lod.governorEngaged,
      triangles: info.render.triangles,
      drawCalls: info.render.calls,
    });
  }

  private frameCamera(radius: number): void {
    const distance = Math.max(radius * 2.6, 12);
    this.camera.position.set(0, 0, distance);
    this.camera.near = Math.max(distance / 500, 0.1);
    this.camera.far = distance * 20;
    this.camera.updateProjectionMatrix();
    this.controls.target.set(0, 0, 0);
    this.controls.update();
  }

  private addLights(): void {
    const key = new THREE.DirectionalLight(0xffffff, 2.1);
    key.position.set(0.4, 0.8, 1);
    const fill = new THREE.DirectionalLight(0x88aaff, 0.7);
    fill.position.set(-1, -0.3, -0.6);
    this.scene.add(key, fill, new THREE.AmbientLight(0xffffff, 0.5));
  }

  private track(...items: Array<{ dispose(): void }>): void {
    this.disposables.push(...items);
  }

  private clear(): void {
    for (const item of this.disposables) item.dispose();
    this.disposables = [];
    this.root.clear();
    this.partnerGroup.clear();
    this.root.add(this.partnerGroup, this.overlay.group);
    this.cartoon = null;
    this.tube = null;
    this.sideChains = null;
    this.ligands = null;
    this.partnerCartoon = null;
    this.partnerSpheres = null;
    this.overlay.clear();
  }

  private resize(): void {
    const width = this.canvas.clientWidth || window.innerWidth;
    const height = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(height, 1);
    this.camera.updateProjectionMatrix();
  }
}
