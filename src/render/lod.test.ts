import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_POLICY, LodController, type LodTargets } from './lod';

function recorder(): LodTargets & { state: Record<string, boolean> } {
  const state: Record<string, boolean> = {
    cartoon: true,
    tube: false,
    sideChains: true,
    ligands: true,
  };
  return {
    state,
    setCartoonVisible: (v) => (state.cartoon = v),
    setTubeVisible: (v) => (state.tube = v),
    setSideChainsVisible: (v) => (state.sideChains = v),
    setLigandsVisible: (v) => (state.ligands = v),
  };
}

describe('LodController', () => {
  let targets: ReturnType<typeof recorder>;
  let lod: LodController;

  beforeEach(() => {
    targets = recorder();
    lod = new LodController(targets, DEFAULT_POLICY);
  });

  it('keeps full detail for a small structure filling the view', () => {
    expect(lod.update(40, 20, 2_000, 12)).toBe(0);
    expect(targets.state.sideChains).toBe(true);
    expect(targets.state.tube).toBe(false);
  });

  it('drops side chains when the atom budget is exceeded', () => {
    expect(lod.update(40, 20, 200_000, 12)).toBe(1);
    expect(targets.state.sideChains).toBe(false);
    expect(targets.state.cartoon).toBe(true);
  });

  it('falls back to the backbone tube when the structure is far away', () => {
    expect(lod.update(1_000, 20, 2_000, 12)).toBe(2);
    expect(targets.state.tube).toBe(true);
    expect(targets.state.cartoon).toBe(false);
    expect(targets.state.ligands).toBe(false);
  });

  it('degrades under sustained over-budget frames and recovers afterwards', () => {
    for (let i = 0; i < 400; i++) lod.update(40, 20, 2_000, 40);
    expect(lod.governorEngaged).toBe(true);
    expect(lod.currentLevel).toBeGreaterThan(0);

    for (let i = 0; i < 2_000; i++) lod.update(40, 20, 2_000, 8);
    expect(lod.governorEngaged).toBe(false);
    expect(lod.currentLevel).toBe(0);
  });

  it('smooths frame time instead of reacting to a single spike', () => {
    for (let i = 0; i < 30; i++) lod.update(40, 20, 2_000, 16);
    const before = lod.smoothedFrameTimeMs;
    lod.update(40, 20, 2_000, 500);
    expect(lod.smoothedFrameTimeMs).toBeLessThan(120);
    expect(lod.smoothedFrameTimeMs).toBeGreaterThan(before);
    expect(lod.governorEngaged).toBe(false);
  });

  it('applies a forced level immediately', () => {
    lod.force(2);
    expect(lod.currentLevel).toBe(2);
    expect(targets.state.tube).toBe(true);
  });

  it('keeps a forced level across later updates', () => {
    lod.force(0);
    for (let i = 0; i < 100; i++) lod.update(1_000, 20, 200_000, 12);
    expect(lod.currentLevel).toBe(0);
    expect(targets.state.sideChains).toBe(true);
  });

  it('lets a forced level override an engaged governor', () => {
    for (let i = 0; i < 400; i++) lod.update(40, 20, 2_000, 40);
    expect(lod.governorEngaged).toBe(true);

    lod.force(0);
    for (let i = 0; i < 400; i++) lod.update(40, 20, 2_000, 40);
    expect(lod.currentLevel).toBe(0);
    expect(targets.state.sideChains).toBe(true);
  });

  it('returns to automatic selection when the force is cleared', () => {
    lod.force(0);
    lod.update(1_000, 20, 2_000, 12);
    expect(lod.currentLevel).toBe(0);

    lod.force(null);
    expect(lod.update(1_000, 20, 2_000, 12)).toBe(2);
    expect(targets.state.tube).toBe(true);
  });

  it('re-applies the current level onto freshly built objects', () => {
    lod.force(2);
    targets.state.sideChains = true;
    targets.state.tube = false;
    lod.reapply();
    expect(targets.state.sideChains).toBe(false);
    expect(targets.state.tube).toBe(true);
  });
});
