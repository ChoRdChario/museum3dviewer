
// LociMyu Material Orchestrator (Step2 scaffold, no-BOM)
// Minimal, safe wiring that does not disturb Step1 behavior.

console.log('[lm-orch] loaded');

const VIEWER_MOD = import('./viewer.module.cdn.js').catch(() => ({}));

const $ = (id) => document.getElementById(id);

function namesFromScene() {
  const s = window.__LM_SCENE;
  const set = new Set();
  s?.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => {
      const n = m?.name;
      if (n && !/^#\d+$/.test(n)) set.add(n);
    });
  });
  return [...set];
}

async function namesFromViewer() {
  const mod = await VIEWER_MOD;
  try {
    const arr = mod.listMaterials?.() || [];
    return [...new Set(arr.map((r) => r?.name).filter((n) => n && !/^#\d+$/.test(n)))];
  } catch {
    return [];
  }
}

function fillSelect(names) {
  const sel = $('pm-material');
  if (!sel) return false;
  const cur = sel.value;
  sel.innerHTML = '<option value="">— Select material —</option>';
  names.forEach((n) => {
    const o = document.createElement('option');
    o.value = n;
    o.textContent = n;
    sel.appendChild(o);
  });
  if (cur && names.includes(cur)) sel.value = cur;
  console.log('[lm-orch] filled', names.length, names);
  return names.length > 0;
}

async function tryFillOnce() {
  const v = await namesFromViewer();
  if (fillSelect(v)) return true;
  return fillSelect(namesFromScene());
}

function wire() {
  const sel = $('pm-material');
  const rng = $('pm-opacity-range');
  const out = $('pm-opacity-val');
  if (!(sel && rng && out)) {
    console.log('[lm-orch] material UI parts missing');
    return;
  }

  const applyByName = async (name, v) => {
    const mod = await VIEWER_MOD;
    if (typeof mod.applyMaterialPropsByName === 'function') {
      mod.applyMaterialPropsByName(name, { opacity: v });
      return;
    }
    if (window.LM_viewer?.applyMaterialPropsByName) {
      window.LM_viewer.applyMaterialPropsByName(name, { opacity: v });
      return;
    }
    // Fallback: raw scene edit
    const s = window.__LM_SCENE;
    s?.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => {
        if ((m?.name || '') === name) {
          m.transparent = v < 1;
          m.opacity = v;
          m.depthWrite = v >= 1;
          m.needsUpdate = true;
        }
      });
    });
  };

  const onInput = () => {
    const n = sel.value;
    if (!n) return;
    const v = Math.max(0, Math.min(1, Number(rng.value || 1)));
    out.textContent = v.toFixed(2);
    applyByName(n, v);
  };
  rng.addEventListener('input', onInput, { passive: true });

  const getOpacity = (name) => {
    let val = null;
    window.__LM_SCENE?.traverse((o) => {
      if (val !== null) return;
      if (!o.isMesh || !o.material) return;
      (Array.isArray(o.material) ? o.material : [o.material]).some((m) => {
        if ((m?.name || '') === name) {
          val = Number(m.opacity ?? 1);
          return true;
        }
        return false;
      });
    });
    return val == null ? 1 : Math.max(0, Math.min(1, val));
  };

  const onChange = () => {
    const n = sel.value;
    const v = n ? getOpacity(n) : 1;
    rng.value = v;
    out.textContent = v.toFixed(2);
  };
  sel.addEventListener('change', onChange);

  // Initial sync
  onChange();
}

document.addEventListener(
  'lm:scene-ready',
  async () => {
    console.log('[lm-orch] scene-ready');
    const deadline = Date.now() + 6000;
    let ok = await tryFillOnce();
    if (!ok) {
      const timer = setInterval(async () => {
        ok = await tryFillOnce();
        if (ok || Date.now() > deadline) {
          clearInterval(timer);
          wire();
        }
      }, 200);
    } else {
      wire();
    }
  },
  { once: true }
);
