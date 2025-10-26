// material.orchestrator.js — minimal glue (one-shot, quiet)
// Purpose:
//  - Wait for GLB to be ready (lm:scene-ready) then enumerate materials once
//  - Dispatch `pm:set-materials` to UI
//  - Bridge `pm:opacity-change` -> applyMaterialPropsByName (with safe fallbacks)
//  - Idempotent & quiet by default; add ?debug=1 to URL for logs

(() => {
  if (window.__MAT_ORCH_INSTALLED__) return;
  window.__MAT_ORCH_INSTALLED__ = true;

  const DEBUG = new URLSearchParams(location.search).has('debug');
  const log = (...a)=>{ if (DEBUG) console.log('[mat-orch]', ...a); };
  const clamp01 = (v)=> Math.max(0, Math.min(1, Number(v)));

  function namesFromScene() {
    const s = window.__LM_SCENE;
    const set = new Set();
    s?.traverse(o => {
      if (!o.isMesh || !o.material) return;
      (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => {
        const n = m?.name || '';
        if (n && !/^#\d+$/.test(n)) set.add(n);
      });
    });
    return [...set];
  }

  async function namesFromViewer() {
    try {
      const mod = await import('./viewer.module.cdn.js');
      if (typeof mod.listMaterialNames === 'function') {
        const list = mod.listMaterialNames() || [];
        return [...new Set(list)].filter(n => !/^#\d+$/.test(n));
      }
      const arr = mod.listMaterials?.() || [];
      return arr.map(r => r?.name).filter(Boolean).filter(n => !/^#\d+$/.test(n));
    } catch {
      return [];
    }
  }

  async function getNamesMerged() {
    const [v, s] = await Promise.all([namesFromViewer(), Promise.resolve(namesFromScene())]);
    const uniq = [...new Set([...(v||[]), ...(s||[])])];
    return uniq;
  }

  async function applyByName(name, props) {
    const v = ('opacity' in (props||{})) ? clamp01(props.opacity) : undefined;
    try {
      const mod = await import('./viewer.module.cdn.js');
      if (typeof mod.applyMaterialPropsByName === 'function') {
        const c = mod.applyMaterialPropsByName(name, props);
        if (c) return c;
      }
    } catch {}
    if (window.LM_viewer?.applyMaterialPropsByName) {
      const c = window.LM_viewer.applyMaterialPropsByName(name, props);
      if (c) return c;
    }
    // Fallback: raw scene write (opacity only)
    if (typeof v === 'number') {
      let cnt = 0;
      const s = window.__LM_SCENE;
      s?.traverse(o => {
        if (!o.isMesh || !o.material) return;
        (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => {
          if ((m?.name||'') === name) {
            m.transparent = v < 1;
            m.opacity = v;
            m.depthWrite = v >= 1;
            m.needsUpdate = true;
            cnt++;
          }
        });
      });
      return cnt;
    }
    return 0;
  }

  async function fillOnce() {
    // Backoff tries to avoid "too-early after scene-ready".
    const delays = [0, 150, 300, 600, 1200];
    for (let i=0; i<delays.length; i++) {
      if (delays[i]) await new Promise(r => setTimeout(r, delays[i]));
      const names = await getNamesMerged();
      if (names.length) {
        log('dispatch pm:set-materials', names);
        document.dispatchEvent(new CustomEvent('pm:set-materials', { detail: names }));
        return true;
      }
    }
    log('no names resolved after backoff');
    return false;
  }

  function onSceneReadyOnce() {
    fillOnce();
  }

  // Wire UI -> runtime (opacity)
  function wireOpacity() {
    if (window.__MAT_ORCH_OPACITY_WIRED__) return;
    window.__MAT_ORCH_OPACITY_WIRED__ = true;
    document.addEventListener('pm:opacity-change', async (e) => {
      const d = e?.detail || {};
      const name = d.name || '';
      const opacity = Number(d.opacity);
      if (!name || !Number.isFinite(opacity)) return;
      const cnt = await applyByName(name, { opacity });
      log('applied opacity', name, opacity, 'count=', cnt);
    });
  }

  // Orchestrate
  wireOpacity();

  if (window.__LM_SCENE) {
    // Scene might already be present
    queueMicrotask(onSceneReadyOnce);
  } else {
    document.addEventListener('lm:scene-ready', onSceneReadyOnce, { once: true });
  }
})();
