// material.ui.orch.js
// LociMyu Material UI Orchestrator (V2, one-shot, no polling)
// - waits for lm:model-ready (or scene-ready fallback) then fills once
// - idempotent wiring, no noisy logs

if (window.__LM_MAT_UI_ORCH_V2__) {
  // already installed
} else {
  window.__LM_MAT_UI_ORCH_V2__ = true;
  console.log('[lm-orch] loaded');

  // ---- tiny helpers ----
  const $ = (id) => document.getElementById(id);
  const clamp01 = (v) => Math.max(0, Math.min(1, Number(v)));

  // try to import viewer API lazily (doesn't throw if missing)
  let viewerModPromise = null;
  const getViewerMod = () => {
    if (!viewerModPromise) {
      viewerModPromise = import('./viewer.module.cdn.js').catch(() => ({}));
    }
    return viewerModPromise;
  };

  // list names via viewer API
  async function namesFromViewer() {
    try {
      const mod = await getViewerMod();
      const arr = (typeof mod.listMaterials === 'function') ? (mod.listMaterials() || []) : [];
      return arr.map((r) => r?.name).filter(Boolean);
    } catch {
      return [];
    }
  }

  // list names by traversing scene directly
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

  // fill select (preserve current selection if still valid)
  function fillSelect(names) {
    const sel = $('pm-material');
    if (!sel || !Array.isArray(names)) return false;
    const uniq = [...new Set(names)];
    const cur = sel.value;
    sel.innerHTML = '<option value="">— Select material —</option>';
    uniq.forEach((n) => {
      const o = document.createElement('option');
      o.value = n;
      o.textContent = n;
      sel.appendChild(o);
    });
    if (cur && uniq.includes(cur)) sel.value = cur;
    console.log('[lm-orch] filled', uniq.length, uniq);
    return uniq.length > 0;
  }

  // apply opacity by material name (viewer API -> fallback)
  async function setOpacityByName(name, v) {
    v = clamp01(v);
    let count = 0;
    const mod = await getViewerMod();

    if (typeof mod.applyMaterialPropsByName === 'function') {
      count = mod.applyMaterialPropsByName(name, { opacity: v });
    } else if (window.LM_viewer?.applyMaterialPropsByName) {
      count = window.LM_viewer.applyMaterialPropsByName(name, { opacity: v });
    } else {
      const s = window.__LM_SCENE;
      s?.traverse((o) => {
        if (!o.isMesh || !o.material) return;
        (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => {
          if ((m?.name || '') === name) {
            m.transparent = v < 1;
            m.opacity = v;
            m.depthWrite = v >= 1;
            m.needsUpdate = true;
            count++;
          }
        });
      });
    }
    return count;
  }

  // read current opacity for selection (first match)
  function getOpacityByName(name) {
    let val = null;
    const s = window.__LM_SCENE;
    s?.traverse((o) => {
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
    return clamp01(val == null ? 1 : val);
  }

  // idempotent wiring
  function wire() {
    const sel = $('pm-material');
    const rng = $('pm-opacity-range');
    const out = $('pm-opacity-val');
    if (!(sel && rng && out)) return;

    const onChange = () => {
      const n = sel.value;
      const v = n ? getOpacityByName(n) : 1;
      rng.value = v;
      out.textContent = v.toFixed(2);
    };
    const onInput = async () => {
      const n = sel.value;
      if (!n) return;
      const v = clamp01(rng.value || 1);
      out.textContent = v.toFixed(2);
      await setOpacityByName(n, v);
    };

    // prevent double binding
    sel.__lm_orch_bound__ || (sel.addEventListener('change', onChange), sel.__lm_orch_bound__ = true);
    rng.__lm_orch_bound__ || (rng.addEventListener('input', onInput, { passive: true }), rng.__lm_orch_bound__ = true);

    // initial sync
    onChange();
  }

  // one-shot runner when model is ready
  let ran = false;
  async function runOnce() {
    if (ran) return;
    ran = true;

    // try viewer first, fallback to scene
    const viaViewer = await namesFromViewer();
    if (fillSelect(viaViewer)) {
      wire();
      return;
    }
    const viaScene = namesFromScene();
    fillSelect(viaScene);
    wire();
  }

  // prefer model-ready (bridge dispatches this after GLB attached)
  document.addEventListener(
    'lm:model-ready',
    () => {
      console.log('[lm-orch] model-ready');
      runOnce();
    },
    { once: true }
  );

  // fallback: if someone dispatches scene-ready earlier (older flows)
  document.addEventListener(
    'lm:scene-ready',
    () => {
      console.log('[lm-orch] scene-ready');
      runOnce();
    },
    { once: true }
  );
}
