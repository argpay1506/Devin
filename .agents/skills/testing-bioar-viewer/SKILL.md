---
name: testing-bioar-viewer
description: How to run and end-to-end test the BioAR three.js molecular viewer web prototype (Vite app at repo root), including UI control ids, docking sandbox flow, and the software-WebGL pitfalls that distort LOD/FPS results.
---

# Testing the BioAR web prototype

## Running it
- `npm install` (already in blueprint-less repos), then `npm run dev` → http://localhost:5173. No auth, no env vars, no credentials.
- Other useful commands: `npm test` (vitest), `npm run typecheck`, `npm run build`.
- 1CRN / 1UBQ / 4INS / 1BRS are bundled as mmCIF under `src/data/bundled/` and load offline; everything else is fetched from `https://files.rcsb.org/download/<ID>.cif`. Verify network reachability first with `curl -sI https://files.rcsb.org/download/1GFL.cif` — if it is blocked, treat remote-fetch tests as environment-blocked, not bugs.

## UI control ids (index.html)
`#pdb-input`, `#pdb-load`, `#status`, `#bundled-select`, `#remote-select`, `#coloring-select`
(`secondaryStructure|chain|element|bFactor`), `#detail-select` (`auto|0|1|2`), `#rotate-toggle`,
`#chain-a`, `#chain-b`, `#dock-toggle`, `#separation` (range, min -4 max 30), `#separation-value`,
`#score-readout`, `#hud`. HUD text is set in `src/main.ts:renderHud`.

## Docking sandbox flow (the primary feature to prove)
1. Load 1BRS (bundled default). Its preset partners are chains **A** and **D** (`src/data/library.ts`).
2. Tick `Enable docking mode`; the score table renders only when both chain selects differ.
3. Drag `#separation`. Expected direction of travel: at 0 Å strongly favourable (~-137, ~17 H-bonds,
   ~1,200 contacts, ~1,570 Å² buried); by ~15 Å everything is 0.0; at the -4 Å end of the slider the
   chains interpenetrate and you get hundreds of steric clashes and a large positive score (~+2800).
4. Overlays: cyan dashed lines = H-bonds, red points = clashes (`src/render/overlays.ts`). They are
   small — zoom the screenshot region around the interface to see them.
5. Scoring is throttled to ~15 Hz off the render loop, so pause ~2 s after moving the slider before
   reading numbers.
6. Single-chain structures (1CRN, 1UBQ) correctly disable `#dock-toggle` and `#separation`.

## Software WebGL is the big gotcha
Headless boxes here run ANGLE/SwiftShader (check via `WEBGL_debug_renderer_info`), so 1BRS renders at
only 3–17 fps. Consequences:
- Do **not** treat low FPS or `[governor active]` in the HUD as a product bug.
- The LOD governor (`src/render/lod.ts`, degrades after 45 over-budget frames ≈ 10 s) will silently
  drop detail to medium/low mid-test, hiding side-chain impostors and even the cartoon. Reload the
  page (F5) immediately before any test that needs full detail, and capture the screenshot within a
  few seconds.
- Known bug found in this repo: `#detail-select` Full/Medium/Low has no lasting effect, because
  `LodController.force()` is overridden by `LodController.update()` on the very next frame
  (`level = max(distanceLevel, loadLevel, governorFloor)`). If a fix lands, retest by selecting each
  Detail option on a fresh load and confirming the HUD `detail:` label matches the selection and
  stays there for >5 s. A likely fix is a `forced` flag that `update()` respects.
- Related: after loading a new structure the LOD level is not re-applied, so the HUD `detail:` label
  can disagree with what is actually drawn. Always cross-check the HUD label against pixels.

## Verifying the custom impostor spheres
`src/render/impostorSpheres.ts` is a `RawShaderMaterial` (GLSL3) writing `gl_FragDepth`. If it fails
to compile, cartoon ribbons still render but atoms are invisible. So the pass criterion for "renders"
is *both* ribbons and round shaded spheres in the screenshot, plus an empty console (check
`browser_console`; a GLSL failure shows up as a `THREE.WebGLProgram` error).

## Devin Secrets Needed
None.
