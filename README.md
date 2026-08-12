# BioAR — web prototype

Three.js prototype of the BioAR molecular explorer: real mmCIF/PDB parsing,
instanced impostor + cartoon rendering with LOD, and a chain-docking sandbox
that reports a relative interaction score, steric clashes and hydrogen bonds.

This is the pre-AR spike. Structural and scoring code in `src/core` is
renderer-independent so it can be ported to Unity/AR Foundation later.

## Run

```sh
npm install
npm run dev      # http://localhost:5173
```

## Checks

```sh
npm run typecheck
npm run lint
npm run test
npm run build
```

## Layout

- `src/core` — mmCIF/PDB parsers, bond inference, secondary structure, SASA,
  neighbour grid, interaction scoring. No Three.js imports.
- `src/render` — impostor spheres, bond sticks, cartoon ribbons, interaction
  overlays, LOD controller, viewer.
- `src/data` — bundled offline structures (1CRN, 1UBQ, 4INS, 1BRS) and RCSB /
  AlphaFold fetching.

## Scientific caveat

The docking readout is a relative empirical score in arbitrary units, intended
for comparing poses of the same complex. It is not a binding free energy and
not a predicted affinity.
