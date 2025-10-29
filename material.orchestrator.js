// material.orchestrator.js  — v2025-10-29
// Purpose: Populate material select *after* GLB load completes and wire opacity preview.
// Depends on: viewer bridge dispatching lm:scene-ready / lm:model-ready.

(() => {
  const $ = (s) => document.querySelector(s);
  const log = (...a) => console.log('[mat-orch]', ...a);

  let wired = false;
  let lastNames = [];
  let populateTimer = null;

  // ---- material name collectors ----
  function listFromViewer() {
    try {
      const v = window.__LM_VIEWER || {};
      const arr = typeof v.listMaterials === 'function' ? v.listMaterials() : [];
      return (arr || []).map(r => r?.name || r).filter(Boolean);
    } catch { return []; }
  }
  function listFromScene() {
    const s = window.__LM_SCENE;
    if (!s) return [];
    const set = new Set();
    s.traverse(o => {
      if (!o.isMesh || !o.material) return;
      (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => {
        const n = m?.name;
        if (n && !/^#\d+$/.test(n)) set.add(n);
      });
    });
    return [...set];
  }
  function collectNames() {
    const names = [...new Set([...listFromViewer(), ...listFromScene()])];
    return names.sort((a,b)=>a.localeCompare(b));
  }

  // ---- fill select ----
  function fillSelect(names) {
    const sel = $('#pm-material');
    if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = '<option value=\"\">— Select material —</option>' +
      names.map(n => `<option value=\"${n}\">${n}</option>`).join('');
    if (cur && names.includes(cur)) sel.value = cur;
  }

  // ---- populate runner (retry until model is truly ready) ----
  function schedulePopulate(delay = 0) {
    clearTimeout(populateTimer);
    populateTimer = setTimeout(async () => {
      const deadline = Date.now() + 8000; // up to 8s
      let names = collectNames();
      if (!names.length) log('materials empty, will retry until model fully ready…');
      while (!names.length && Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 200));
        names = collectNames();
      }
      if (!names.length) {
        log('materials still empty after retries (will wait for next model)');
        return;
      }
      lastNames = names;
      fillSelect(names);
      log('materials populated:', names.length);
    }, delay);
  }

  // ---- preview handlers ----
  function setOpacityByName(name, v) {
    v = Math.max(0, Math.min(1, Number(v)));
    const s = window.__LM_SCENE;
    if (!s || !name) return;
    s.traverse(o => {
      if (!o.isMesh || !o.material) return;
      (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => {
        if ((m?.name || '') === name) {
          m.transparent = v < 1;
          m.opacity = v;
          m.depthWrite = v >= 1;
          m.needsUpdate = true;
        }
      });
    });
  }

  function wireOnce() {
    if (wired) return; wired = true;

    $('#tab-material')?.addEventListener('click', () => schedulePopulate(0));
    document.addEventListener('pm:request-materials', () => schedulePopulate(0));

    document.addEventListener('lm:model-ready', () => schedulePopulate(0), { passive: true });
    document.addEventListener('lm:scene-ready', () => schedulePopulate(100), { passive: true });

    const sel = $('#pm-material');
    const rng = $('#pm-opacity-range');
    const out = $('#pm-opacity-val');
    if (sel && rng && out) {
      rng.addEventListener('input', () => {
        out.textContent = Number(rng.value).toFixed(2);
        if (sel.value) setOpacityByName(sel.value, Number(rng.value));
      });
      sel.addEventListener('change', () => {
        if (sel.value) setOpacityByName(sel.value, Number(rng.value));
      });
    }

    // Initial populate (slightly delayed to avoid racing)
    window.setTimeout(() => schedulePopulate(300), 400);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wireOnce, { once:true });
  } else {
    wireOnce();
  }
})();
