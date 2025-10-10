// Pins UI wiring — palette, filters, basic actions. Keeps logic simple.
// Later we will connect Drive/Sheets once auth path is stable.

import { ensureViewer } from './viewer.js';

const PALETTE = [
  { key: 'sky',  hex: '#60a5fa' },
  { key: 'lime', hex: '#22c55e' },
  { key: 'amber',hex: '#f59e0b' },
  { key: 'violet',hex: '#8b5cf6' },
  { key: 'rose', hex: '#f43f5e' },
];

export function setupPins({ viewer }) {
  // Required elements
  const palette = document.getElementById('pin-palette');
  const filters = document.getElementById('pin-filters');
  const list    = document.getElementById('caption-list');
  const btnLoad = document.getElementById('btn-load-glb');
  const btnRef  = document.getElementById('btn-refresh-images');
  const btnDrv  = document.getElementById('btn-open-drive');

  if (!palette || !filters || !list) {
    console.warn('[pins] required elements missing');
    return;
  }

  // Build palette (horizontal)
  palette.innerHTML = '';
  let current = 'sky';
  for (const c of PALETTE) {
    const sw = document.createElement('button');
    sw.className = 'swatch';
    sw.style.background = c.hex;
    sw.setAttribute('title', c.key);
    sw.setAttribute('aria-selected', String(c.key === current));
    sw.addEventListener('click', () => {
      current = c.key;
      for (const el of palette.querySelectorAll('.swatch')) el.setAttribute('aria-selected', 'false');
      sw.setAttribute('aria-selected', 'true');
      viewer?.setColor?.(c.hex);
    });
    palette.appendChild(sw);
  }

  // Build filters (color chip + checkbox pairs)
  filters.innerHTML = '';
  const state = new Map(PALETTE.map(c => [c.key, true]));
  for (const c of PALETTE) {
    const row = document.createElement('label');
    row.className = 'toggle';
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = c.hex;
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = true;
    cb.addEventListener('change', () => {
      state.set(c.key, cb.checked);
      console.debug('[pins] filter toggled', c.key, cb.checked);
      // later: hide/show pins by color
    });
    const name = document.createElement('span');
    name.textContent = c.key;
    name.className = 'muted tiny';
    row.append(dot, cb, name);
    filters.appendChild(row);
  }

  // Basic list placeholder to verify layout
  list.innerHTML = '';
  const empty = document.createElement('div');
  empty.className = 'item muted';
  empty.textContent = 'No captions loaded yet.';
  list.appendChild(empty);

  // Toolbar buttons (currently stubbed; will be wired after auth)
  btnLoad?.addEventListener('click', () => console.debug('[GLB] requested load (demo)'));
  btnRef?.addEventListener('click', () => console.debug('[images] refresh (demo)'));
  btnDrv?.addEventListener('click', () => console.debug('[drive] open (demo)'));

  console.debug('[pins] ready');
}
