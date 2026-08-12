import './style.css';
import type { InteractionResult } from './core/interactions';
import type { Structure } from './core/types';
import { loadPdbId, StructureFetchError } from './data/fetchStructure';
import { BUNDLED_LIBRARY, REMOTE_LIBRARY, type LibraryEntry } from './data/library';
import type { Coloring } from './render/representations';
import { Viewer, type ViewerStats } from './render/viewer';
import type { DetailLevel } from './render/lod';

const canvas = requireElement<HTMLCanvasElement>('stage');
const pdbInput = requireElement<HTMLInputElement>('pdb-input');
const pdbLoad = requireElement<HTMLButtonElement>('pdb-load');
const statusEl = requireElement<HTMLParagraphElement>('status');
const blurbEl = requireElement<HTMLParagraphElement>('blurb');
const bundledSelect = requireElement<HTMLSelectElement>('bundled-select');
const remoteSelect = requireElement<HTMLSelectElement>('remote-select');
const coloringSelect = requireElement<HTMLSelectElement>('coloring-select');
const detailSelect = requireElement<HTMLSelectElement>('detail-select');
const rotateToggle = requireElement<HTMLInputElement>('rotate-toggle');
const chainASelect = requireElement<HTMLSelectElement>('chain-a');
const chainBSelect = requireElement<HTMLSelectElement>('chain-b');
const dockToggle = requireElement<HTMLInputElement>('dock-toggle');
const separationInput = requireElement<HTMLInputElement>('separation');
const separationValue = requireElement<HTMLOutputElement>('separation-value');
const scoreReadout = requireElement<HTMLDivElement>('score-readout');
const hud = requireElement<HTMLDivElement>('hud');

const viewer = new Viewer(canvas);
let current: Structure | null = null;

viewer.onStats(renderHud);
viewer.onScore(renderScore);

populateLibrary();
wireEvents();
void load('1BRS');

function wireEvents(): void {
  pdbLoad.addEventListener('click', () => void load(pdbInput.value));
  pdbInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') void load(pdbInput.value);
  });

  bundledSelect.addEventListener('change', () => {
    if (bundledSelect.value) void load(bundledSelect.value);
  });
  remoteSelect.addEventListener('change', () => {
    if (remoteSelect.value) void load(remoteSelect.value);
  });

  coloringSelect.addEventListener('change', () => {
    viewer.setColoring(coloringSelect.value as Coloring);
  });

  detailSelect.addEventListener('change', () => {
    const value = detailSelect.value;
    viewer.forceDetail(value === 'auto' ? 'auto' : (Number(value) as DetailLevel));
  });

  rotateToggle.addEventListener('change', () => viewer.setAutoRotate(rotateToggle.checked));

  dockToggle.addEventListener('change', () => applyMode());
  chainASelect.addEventListener('change', () => applyMode());
  chainBSelect.addEventListener('change', () => applyMode());

  separationInput.addEventListener('input', () => {
    const separation = Number(separationInput.value);
    separationValue.textContent = `${separation.toFixed(1)} Å`;
    viewer.setSeparation(separation);
  });
}

function populateLibrary(): void {
  fillSelect(bundledSelect, BUNDLED_LIBRARY);
  fillSelect(remoteSelect, REMOTE_LIBRARY);
}

function fillSelect(select: HTMLSelectElement, entries: readonly LibraryEntry[]): void {
  select.innerHTML = '';
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Select…';
  select.append(placeholder);
  for (const entry of entries) {
    const option = document.createElement('option');
    option.value = entry.pdbId;
    option.textContent = `${entry.pdbId} — ${entry.name}`;
    select.append(option);
  }
}

async function load(id: string): Promise<void> {
  const trimmed = id.trim();
  if (trimmed === '') return;

  setStatus(`Loading ${trimmed.toUpperCase()}…`, false);
  pdbLoad.disabled = true;
  try {
    const structure = await loadPdbId(trimmed);
    current = structure;
    populateChains(structure);
    applyMode();
    const entry = findEntry(structure.id);
    blurbEl.textContent = entry?.blurb ?? structure.title;
    setStatus(
      `${structure.id}: ${structure.atoms.length.toLocaleString()} atoms, ` +
        `${structure.chains.length} chain(s)`,
      false,
    );
  } catch (error) {
    const message =
      error instanceof StructureFetchError ? error.message : `Failed to load: ${String(error)}`;
    setStatus(message, true);
  } finally {
    pdbLoad.disabled = false;
  }
}

function populateChains(structure: Structure): void {
  const polymerChains = structure.chains.filter((chain) =>
    chain.residueIndices.some((index) => !structure.residues[index].hetero),
  );
  for (const select of [chainASelect, chainBSelect]) {
    select.innerHTML = '';
    for (const chain of polymerChains) {
      const option = document.createElement('option');
      option.value = chain.id;
      option.textContent = chain.id;
      select.append(option);
    }
  }

  const entry = findEntry(structure.id);
  const preset = entry?.docking;
  const fallbackB = polymerChains[1]?.id ?? polymerChains[0]?.id ?? '';
  chainASelect.value = preset?.a ?? polymerChains[0]?.id ?? '';
  chainBSelect.value = preset?.b ?? fallbackB;

  const dockable = polymerChains.length > 1;
  dockToggle.disabled = !dockable;
  if (!dockable) dockToggle.checked = false;
  separationInput.disabled = !dockable;
}

function applyMode(): void {
  if (!current) return;
  const separation = Number(separationInput.value);
  separationValue.textContent = `${separation.toFixed(1)} Å`;

  if (dockToggle.checked && chainASelect.value && chainBSelect.value !== chainASelect.value) {
    viewer.load(current, {
      chainA: chainASelect.value,
      chainB: chainBSelect.value,
      separation,
    });
  } else {
    viewer.load(current, null);
    renderScore(null);
  }
}

function renderScore(result: InteractionResult | null): void {
  if (!result) {
    scoreReadout.innerHTML =
      '<p class="hint">Enable docking mode on a multi-chain structure to score the interface.</p>';
    return;
  }

  const rows: Array<[string, string, string?]> = [
    ['Interaction score', result.interactionScore.toFixed(1), 'total'],
    ['van der Waals', result.terms.vanDerWaals.toFixed(1)],
    ['Electrostatic', result.terms.electrostatic.toFixed(1)],
    ['Hydrogen bonding', result.terms.hydrogenBond.toFixed(1)],
    ['Desolvation', result.terms.desolvation.toFixed(1)],
    ['Clash penalty', result.terms.clashPenalty.toFixed(1), result.clashes.length ? 'clash' : ''],
    ['H-bonds', String(result.hydrogenBonds.length)],
    ['Steric clashes', String(result.clashes.length), result.clashes.length ? 'clash' : ''],
    ['Buried area', `${result.buriedArea.toFixed(0)} Å²`],
    ['Contacts < 6 Å', result.contactCount.toLocaleString()],
  ];

  const dl = document.createElement('dl');
  for (const [label, value, className] of rows) {
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = value;
    if (className) {
      dt.className = className;
      dd.className = className;
    }
    dl.append(dt, dd);
  }
  scoreReadout.replaceChildren(dl);
}

function renderHud(stats: ViewerStats): void {
  hud.textContent = [
    `${stats.structureId}  ${stats.atoms.toLocaleString()} atoms  ` +
      `${stats.residues.toLocaleString()} residues  ${stats.chains} chains`,
    `${stats.fps.toFixed(0)} fps  ${stats.frameTimeMs.toFixed(1)} ms/frame  ` +
      `${stats.drawCalls} draw calls  ${stats.triangles.toLocaleString()} tris`,
    `detail: ${stats.detail}${stats.governorEngaged ? '  [governor active]' : ''}`,
  ].join('\n');
}

function findEntry(pdbId: string): LibraryEntry | undefined {
  return [...BUNDLED_LIBRARY, ...REMOTE_LIBRARY].find((entry) => entry.pdbId === pdbId);
}

function setStatus(message: string, isError: boolean): void {
  statusEl.textContent = message;
  statusEl.classList.toggle('error', isError);
}

function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element #${id}`);
  return element as T;
}
