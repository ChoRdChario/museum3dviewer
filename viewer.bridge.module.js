
// viewer.bridge.module.js — v2 (quiet, one-shot with safe retries)
// This module fills the material list and wires the opacity slider AFTER the GLB is ready.
// It listens to `lm:scene-ready` once, and falls back to checking __LM_SCENE if the event was missed.

const qs = new URLSearchParams(location.search);
const DEBUG = qs.has('debug') && qs.get('debug') !== '0';
const log = (...a) => { if (DEBUG) console.log('[bridge]', ...a); };

const $ = (id) => document.getElementById(id);

// ---- helpers ----
function namesFromScene() {
  const s = window.__LM_SCENE;
  const set = new Set();
  s?.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    (Array.isArray(o.material) ? o.material : [o.material])
      .forEach(m => m?.name && set.add(m.name));
  });
  // filter out '#0' style anonymous placeholders
  return [...set].filter(n => !/^#\d+$/.test(n));
}

async function namesFromViewer() {
  try {
    const mod = await import('./viewer.module.cdn.js');
    const arr = mod.listMaterials?.() || [];
    return arr.map(r => r?.name).filter(Boolean).filter(n => !/^#\d+$/.test(n));
  } catch { return []; }
}

async function getNamesMerged() {
  const [v, s] = await Promise.all([namesFromViewer(), Promise.resolve(namesFromScene())]);
  const uniq = [...new Set([...(v||[]), ...(s||[])])];
  return uniq;
}

function fillSelect(names) {
  const sel = $('pm-material');
  if (!sel) return false;
  const cur = sel.value;
  sel.innerHTML = '<option value="">— Select material —</option>';
  names.forEach(n => {
    const o = document.createElement('option');
    o.value = n; o.textContent = n;
    sel.appendChild(o);
  });
  if (cur && names.includes(cur)) sel.value = cur;
  log('filled', names.length, names);
  return names.length > 0;
}

async function setOpacityByName(name, v) {
  v = Math.max(0, Math.min(1, Number(v)));
  let count = 0;
  try {
    const mod = await import('./viewer.module.cdn.js');
    if (typeof mod.applyMaterialPropsByName === 'function') {
      count = mod.applyMaterialPropsByName(name, { opacity: v });
      if (count) return count;
    }
    if (window.LM_viewer?.applyMaterialPropsByName) {
      count = window.LM_viewer.applyMaterialPropsByName(name, { opacity: v });
      if (count) return count;
    }
  } catch {}
  // fallback: write to scene
  const s = window.__LM_SCENE;
  s?.traverse(o => {
    if (!o.isMesh || !o.material) return;
    (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => {
      if ((m?.name || '') === name) {
        m.transparent = v < 1;
        m.opacity = v;
        m.depthWrite = v >= 1;
        m.needsUpdate = true;
        count++;
      }
    });
  });
  return count;
}

function getOpacityByName(name) {
  let val = null;
  const s = window.__LM_SCENE;
  s?.traverse(o => {
    if (val !== null) return;
    if (!o.isMesh || !o.material) return;
    (Array.isArray(o.material) ? o.material : [o.material]).some(m => {
      if ((m?.name || '') === name) { val = Number(m.opacity ?? 1); return true; }
      return false;
    });
  });
  return (val == null ? 1 : Math.max(0, Math.min(1, val)));
}

// ---- wiring (idempotent) ----
let WIRED = false;
function wireUI() {
  if (WIRED) return;
  const sel = $('pm-material');
  const rng = $('pm-opacity-range');
  const out = $('pm-opacity-val');
  if (!(sel && rng && out)) {
    log('material UI parts missing');
    return;
  }
  // select -> reflect current opacity
  const onChange = () => {
    const n = sel.value;
    const v = n ? getOpacityByName(n) : 1;
    rng.value = v;
    out.textContent = v.toFixed(2);
    log('sync', n, v);
  };
  // slider -> apply
  const onInput = async () => {
    const n = sel.value;
    if (!n) return;
    const v = Number(rng.value || 1);
    out.textContent = v.toFixed(2);
    const applied = await setOpacityByName(n, v);
    log('apply opacity', n, v, '->', applied);
  };
  rng.addEventListener('input', onInput, { passive: true });
  sel.addEventListener('change', onChange);
  // initial
  onChange();
  WIRED = true;
  log('wired');
}

// ---- orchestrator: run once after GLB is ready ----
let FILLED = false;
async function tryFillOnceWithBackoff() {
  // backoff: 0ms, 150ms, 300ms, 600ms, 1200ms (max 5 tries)
  const delays = [0, 150, 300, 600, 1200];
  for (let i = 0; i < delays.length; i++) {
    if (delays[i]) await new Promise(r => setTimeout(r, delays[i]));
    const names = await getNamesMerged();
    if (names.length && fillSelect(names)) {
      FILLED = true;
      wireUI();
      return true;
    }
  }
  log('names not ready (backoff exhausted)');
  return false;
}

function onSceneReadyOnce() {
  if (FILLED) return;
  tryFillOnceWithBackoff();
}

// If event fires after GLB load
document.addEventListener('lm:scene-ready', onSceneReadyOnce, { once: true });

// If the event was missed (page already has __LM_SCENE), run after DOM settles
if (window.__LM_SCENE) {
  queueMicrotask(() => onSceneReadyOnce());
}

// Also, ensure DOM is ready before trying to wire
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { /* nothing; wiring occurs after fill */ });
} else {
  // DOM already ready
}
