export type DetailLevel = 0 | 1 | 2;

export const DETAIL_LABELS: Record<DetailLevel, string> = {
  0: 'full (cartoon + side chains)',
  1: 'medium (cartoon + ligands)',
  2: 'low (backbone tube)',
};

export interface LodTargets {
  setCartoonVisible(visible: boolean): void;
  setTubeVisible(visible: boolean): void;
  setSideChainsVisible(visible: boolean): void;
  setLigandsVisible(visible: boolean): void;
}

export interface LodPolicy {
  /** Side chains are dropped above this atom count regardless of distance. */
  sideChainAtomBudget: number;
  /** Frame time in ms that counts as over budget. */
  frameBudgetMs: number;
  /** Consecutive over-budget frames before stepping detail down. */
  degradeAfterFrames: number;
  /** Consecutive comfortable frames before stepping detail back up. */
  recoverAfterFrames: number;
}

export const DEFAULT_POLICY: LodPolicy = {
  sideChainAtomBudget: 60_000,
  frameBudgetMs: 20,
  degradeAfterFrames: 45,
  recoverAfterFrames: 240,
};

/**
 * Distance-and-load driven level of detail with a thermal-style governor.
 *
 * Two independent inputs pick the level: how much of the screen the structure
 * covers (far away, side chains are sub-pixel) and measured frame time. The
 * governor is what keeps a sustained session usable — on mobile the device
 * throttles after a few minutes, and stepping detail down first is far better
 * than letting the OS halve the frame rate.
 */
export class LodController {
  private level: DetailLevel = 0;
  private overBudgetFrames = 0;
  private comfortableFrames = 0;
  private governorFloor: DetailLevel = 0;
  private frameTimeEma = 16;
  private forced: DetailLevel | null = null;

  constructor(
    private readonly targets: LodTargets,
    private readonly policy: LodPolicy = DEFAULT_POLICY,
  ) {}

  get currentLevel(): DetailLevel {
    return this.level;
  }

  get smoothedFrameTimeMs(): number {
    return this.frameTimeEma;
  }

  get governorEngaged(): boolean {
    return this.governorFloor > 0;
  }

  /**
   * @param cameraDistance distance from camera to structure centre
   * @param structureRadius bounding radius of the structure
   * @param atomCount total atoms in the structure
   * @param frameTimeMs last frame duration
   */
  update(
    cameraDistance: number,
    structureRadius: number,
    atomCount: number,
    frameTimeMs: number,
  ): DetailLevel {
    this.frameTimeEma = this.frameTimeEma * 0.9 + frameTimeMs * 0.1;

    if (this.frameTimeEma > this.policy.frameBudgetMs) {
      this.overBudgetFrames++;
      this.comfortableFrames = 0;
      if (this.overBudgetFrames >= this.policy.degradeAfterFrames && this.governorFloor < 2) {
        this.governorFloor = (this.governorFloor + 1) as DetailLevel;
        this.overBudgetFrames = 0;
      }
    } else {
      this.comfortableFrames++;
      this.overBudgetFrames = 0;
      if (this.comfortableFrames >= this.policy.recoverAfterFrames && this.governorFloor > 0) {
        this.governorFloor = (this.governorFloor - 1) as DetailLevel;
        this.comfortableFrames = 0;
      }
    }

    // Screen coverage proxy: radius over distance. Below ~0.12 the structure
    // occupies a small part of the view and detail is wasted.
    const coverage = structureRadius / Math.max(cameraDistance, 1e-3);
    let distanceLevel: DetailLevel = 0;
    if (coverage < 0.08) distanceLevel = 2;
    else if (coverage < 0.2) distanceLevel = 1;

    const loadLevel: DetailLevel = atomCount > this.policy.sideChainAtomBudget ? 1 : 0;
    // An explicit user choice outranks every automatic input, including the
    // governor: otherwise the selector appears dead and a throttled session can
    // never get detail back.
    const level =
      this.forced ?? (Math.max(distanceLevel, loadLevel, this.governorFloor) as DetailLevel);

    if (level !== this.level) {
      this.level = level;
      this.apply(level);
    }
    return level;
  }

  /** Pins a level, or pass `null` to hand control back to automatic selection. */
  force(level: DetailLevel | null): void {
    this.forced = level;
    if (level === null) return;
    this.level = level;
    this.apply(level);
  }

  /** Re-applies the current level, e.g. after representations are rebuilt. */
  reapply(): void {
    this.apply(this.level);
  }

  private apply(level: DetailLevel): void {
    this.targets.setCartoonVisible(level < 2);
    this.targets.setTubeVisible(level === 2);
    this.targets.setSideChainsVisible(level === 0);
    this.targets.setLigandsVisible(level < 2);
  }
}
