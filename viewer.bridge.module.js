// viewer.bridge.module.js
// Minimal, idempotent bridge: populate material list after lm:scene-ready and wire the opacity slider.
// Logging is quiet by default; append ?debug=1 to the URL to enable.
const DEBUG = new URLSearchParams(location.search).has('debug');
const log = (...a)=>{ if (DEBUG) console.log('[viewer-bridge]', ...a); };

// Safe DOM getter
const $ = (id)=> document.getElementById(id);

// --- core helpers ---
function listMaterialNamesFromScene() {
  const s = window.__LM_SCENE;
  const set = new Set();
  s?.traverse(o => {
    if (!o.isMesh || !o.material) return;
    (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => {
      if (m?.name) set.add(m.name);
    });
  });
  // drop anonymous like "#0", "#1"
  return [...set].filter(n => !/^#\d+$/.test(n));
}

function applyOpacityByNameRaw(name, v) {
  // Fallback path: write directly to scene materials
  const s = window.__LM_SCENE;
  let count = 0;
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

function getOpacityByNameRaw(name) {
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

// idempotent UI wiring
function wireUI(mod) {
  const sel = $('pm-material');
  const rng = $('pm-opacity-range');
  const out = $('pm-opacity-val');
  if (!(sel && rng && out)) {
    log('material UI parts missing');
    return;
  }

  // selection -> slider sync
  const onChange = () => {
    const n = sel.value;
    const v = n ? getOpacityByNameRaw(n) : 1;
    rng.value = v;
    out.textContent = v.toFixed(2);
    log('sync', n, v);
  };
  sel.removeEventListener?.('__bridge_change', onChange);
  sel.addEventListener('change', onChange);
  sel.addEventListener('__bridge_change', onChange);

  // slider -> apply
  const onInput = () => {
    const n = sel.value;
    if (!n) return;
    const v = Math.max(0, Math.min(1, Number(rng.value || 1)));
    out.textContent = v.toFixed(2);

    let applied = 0;
    try {
      if (typeof mod?.applyMaterialPropsByName === 'function') {
        applied = mod.applyMaterialPropsByName(n, { opacity: v });
      } else if (window.LM_viewer?.applyMaterialPropsByName) {
        applied = window.LM_viewer.applyMaterialPropsByName(n, { opacity: v });
      } else {
        applied = applyOpacityByNameRaw(n, v);
      }
    } catch (e) {
      applied = applyOpacityByNameRaw(n, v);
    }
    log('apply opacity', n, v, '→', applied);
  };
  rng.removeEventListener?.('__bridge_input', onInput);
  rng.addEventListener('input', onInput, { passive: true });
  rng.addEventListener('__bridge_input', onInput);

  // initial sync
  onChange();
}

// fill material select
function fillMaterialSelect(names) {
  const sel = $('pm-material');
  if (!sel) return false;
  const cur = sel.value;
  const uniq = [...new Set(names)].filter(n => !/^#\d+$/.test(n));
  sel.innerHTML = '<option value="">— Select material —</option>';
  uniq.forEach(n => {
    const o = document.createElement('option');
    o.value = n; o.textContent = n; sel.appendChild(o);
  });
  if (cur && uniq.includes(cur)) sel.value = cur;
  log('filled', uniq.length, uniq);
  return uniq.length > 0;
}

async function main() {
  // Try to import viewer module (optional)
  let mod = null;
  try { mod = await import('./viewer.module.cdn.js'); }
  catch {}

  // Optional window bridge if missing
  if (!window.LM_viewer) {
    window.LM_viewer = {
      listMaterialNames: listMaterialNamesFromScene,
      applyMaterialPropsByName: (name, {opacity}={}) => {
        const v = Math.max(0, Math.min(1, Number(opacity)));
        return applyOpacityByNameRaw(name, v);
      }
    };
    log('LM_viewer shim attached');
  }

  // Populate on each scene-ready (idempotent)
  const refresh = () => {
    const names =
      (typeof mod?.listMaterialNames === 'function' ? mod.listMaterialNames() : null)
      || listMaterialNamesFromScene();
    if (fillMaterialSelect(names)) {
      wireUI(mod);
    }
  };

  // If scene already exists (e.g., cached reload), do an immediate try
  if (window.__LM_SCENE) refresh();

  // Hook to the formal event
  document.addEventListener('lm:scene-ready', () => {
    log('lm:scene-ready received');
    // slight microtask deferral to ensure materials are committed
    queueMicrotask(refresh);
    setTimeout(refresh, 50);
  });

  // Final safety: poll briefly in case the event is missed by the page
  let tries = 0;
  const timer = setInterval(() => {
    tries++;
    const ok = fillMaterialSelect(listMaterialNamesFromScene());
    if (ok || tries >= 40) { // ~8s max
      clearInterval(timer);
      if (ok) wireUI(mod);
    }
  }, 200);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', main, { once: true });
} else {
  main();
}
