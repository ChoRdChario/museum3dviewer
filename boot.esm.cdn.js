// boot.esm.cdn.js — prod wiring + GIS dynamic loader + color filter checkboxes
import { ensureViewer, loadGlbFromUrl } from './viewer.module.cdn.js';
import { setupAuth, getAccessToken } from './gauth.module.js';

const $ = (id) => document.getElementById(id);
const enable = (on, ...els) => els.forEach(el => el && (el.disabled = !on));

// ---------- Viewer ----------
ensureViewer({ canvas: $('gl') });

// ---------- Google Identity Services Loader (defensive) ----------
async function loadGIS(timeoutMs = 8000) {
  if (globalThis.google?.accounts?.id) return true;
  // if a script tag already exists, wait for it
  const existing = Array.from(document.scripts).find(s => /accounts\.google\.com\/gsi\/client/.test(s.src));
  if (!existing) {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true; s.defer = true;
    document.head.appendChild(s);
  }
  const t0 = performance.now();
  while (performance.now() - t0 < timeoutMs) {
    if (globalThis.google?.accounts?.id) return true;
    await new Promise(r => setTimeout(r, 50));
  }
  console.warn('[auth] GIS not available after wait — continuing with stub');
  return false;
}

// ---------- Auth wiring ----------
const btnAuth = $('auth-signin');
const signedSwitch = (signed) => {
  document.documentElement.classList.toggle('signed-in', signed);
  enable(signed, $('btnGlb'), $('btnRefreshImages'), $('glbUrl'), $('save-target-sheet'), $('save-target-create'));
};

(async () => {
  await loadGIS().catch(() => {});
  btnAuth && setupAuth(btnAuth, signedSwitch);
})();

// ---------- GLB load ----------
const normalizeDrive = (v) => {
  if (!v) return '';
  const m = String(v).match(/[-\w]{25,}/);
  if (m) return `https://drive.google.com/uc?export=download&id=${m[0]}`;
  return v;
};
const doLoad = async () => {
  const token = getAccessToken();
  if (!token) { console.warn('[GLB] token missing. Please sign in.'); return; }
  const url = normalizeDrive($('glbUrl')?.value || '');
  if (!url) return;
  try {
    $('btnGlb').disabled = true;
    await loadGlbFromUrl(url, { token });
  } finally {
    $('btnGlb').disabled = false;
  }
};
$('btnGlb')?.addEventListener('click', doLoad);
$('glbUrl')?.addEventListener('keydown', (e) => e.key === 'Enter' && doLoad());

// ---------- Caption: color palette + color filter checkboxes ----------
const COLORS = ['#ff6b6b','#ffd93d','#6bcb77','#4d96ff','#9b5de5','#f15bb5','#00c2a8','#94a3b8'];

// (A) Pin color palette (simple chips)
const pinColorsHost = $('pin-colors');
let currentPinColor = COLORS[0];
if (pinColorsHost) {
  pinColorsHost.innerHTML = COLORS.map(c => `<button class="chip" data-color="${c}" title="${c}" style="background:${c}"></button>`).join('');
  const select = (el) => {
    pinColorsHost.querySelectorAll('.chip').forEach(x => x.style.outline = '');
    el.style.outline = '2px solid #fff4';
    currentPinColor = el.dataset.color;
    // TODO: viewer.setDraftPinColor(currentPinColor)
  };
  pinColorsHost.addEventListener('click', (e) => {
    const b = e.target.closest('[data-color]'); if (!b) return;
    select(b);
  });
  const first = pinColorsHost.querySelector('.chip'); first && select(first);
}

// (B) Color filter = checkbox beside each color
const pinFilterHost = $('pin-filter');
const selectedColors = new Set(COLORS); // default: show all
if (pinFilterHost) {
  pinFilterHost.innerHTML = COLORS.map(c => (
    `<label style="display:flex;align-items:center;gap:6px;margin:2px 8px 2px 0">
       <input type="checkbox" data-color="${c}" checked />
       <span class="chip" style="width:14px;height:14px;background:${c}"></span>
     </label>`
  )).join('');
  pinFilterHost.addEventListener('change', (e) => {
    const cb = e.target.closest('input[type=checkbox][data-color]'); if (!cb) return;
    const color = cb.dataset.color;
    cb.checked ? selectedColors.add(color) : selectedColors.delete(color);
    const ev = new CustomEvent('pinFilterChange', { detail: { selected: Array.from(selectedColors) } });
    document.dispatchEvent(ev);
  });
}

// ---------- Caption buttons (stubs) ----------
$('pin-add')?.addEventListener('click', () => {
  console.log('[Pin] add (color=%s, title=%s, body=%s)',
    currentPinColor, $('caption-title')?.value, $('caption-body')?.value);
});
$('pin-clear')?.addEventListener('click', () => {
  if ($('caption-title')) $('caption-title').value = '';
  if ($('caption-body')) $('caption-body').value = '';
});

// initial state: disabled until signed in
signedSwitch(false);

console.log('[LociMyu ESM/CDN] boot complete');
