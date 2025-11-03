
/* material.orchestrator.js — commit-mode aware replacement
 * Policy:
 *  - If window.__LM_COMMIT_MODE === true:
 *      * select.change: reflect UI from sheet/scene (no persist)
 *      * range.input:  preview material opacity only (no persist)
 *      * range.change/blur: persist once
 *      * programmatic UI updates do not trigger handlers
 *  - Otherwise: fall back to legacy behavior (if needed)
 */

(function () {
  const log = (...a)=>console.log('[mat-orch]', ...a);

  // Global guard (can be set by patches or here)
  if (typeof window.__LM_COMMIT_MODE === 'undefined') window.__LM_COMMIT_MODE = true;

  const $ = (sel, root=document) => root.querySelector(sel);
  const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

  // Weak coupling to other modules the app already exposes
  const sheet = window.materialsSheetBridge || window.materialsSheet || {};
  const vbridge = window.viewerBridge || window.viewer || {};

  // Small helper: get scene if exposed
  function getScene() {
    try { return (vbridge.getScene && vbridge.getScene()) || vbridge.scene || null; } catch(e){ return null; }
  }

  // Apply opacity to all meshes whose material name matches `matName`
  function applyOpacityByName(matName, opacity) {
    const scene = getScene();
    if (!scene) return;
    let count = 0;
    scene.traverse?.((obj)=>{
      const m = obj?.material;
      if (!m) return;
      const mats = Array.isArray(m) ? m : [m];
      mats.forEach(mm=>{
        if (mm && mm.name === matName) { mm.transparent = opacity < 1.0; mm.opacity = opacity; count++; }
      });
    });
    log(`opacity ${(+opacity).toFixed(2)} → "${matName}" x${count}`);
  }

  // Load saved opacity from sheet for the material, else fallback to current scene value
  async function loadOpacityFor(matName) {
    // try sheet first
    try {
      const row = await (sheet.getOne ? sheet.getOne(matName) : null);
      if (row && row.opacity != null && row.opacity !== '') {
        return parseFloat(row.opacity);
      }
    } catch (e) { /* ignore */ }

    // fallback: probe from scene
    const scene = getScene();
    let found = null;
    scene?.traverse?.((obj)=>{
      const m = obj?.material;
      if (found != null || !m) return;
      const mats = Array.isArray(m) ? m : [m];
      for (const mm of mats) {
        if (mm && mm.name === matName) { found = (mm.opacity ?? 1); break; }
      }
    });
    return (found != null) ? found : 1.0;
  }

  // Persist to sheet
  async function persistOpacity(matName, opacity) {
    if (!sheet.upsertOne) return;
    try {
      await sheet.upsertOne({ materialKey: matName, opacity: +opacity, updatedAt: Date.now() });
      log('persisted to sheet:', matName);
    } catch(e) {
      console.warn('[mat-orch] persist failed', e);
    }
  }

  // Wire UI
  async function wirePanel() {
    const pane = document.getElementById('pane-material') || document;
    const sel = $('#materialSelect', pane) || $('select#materialSelect', pane) || $('select[name="materialSelect"]', pane);
    const range = $('#opacityRange', pane) || $('input#opacityRange', pane) || $('input[name="opacityRange"]', pane);

    if (!sel || !range) {
      log('ui not ready yet, retry... UI elements not found (materialSelect/opacityRange)');
      setTimeout(wirePanel, 200);
      return;
    }

    // prevent legacy multiple wiring
    if (sel.__lmWired && range.__lmWired) return;
    sel.__lmWired = range.__lmWired = true;

    // programmatic-set guard on the slider
    const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(range), 'value')
              || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    let programmatic = false;
    Object.defineProperty(range, 'value', {
      configurable: true,
      get(){ return desc.get.call(this); },
      set(v){ programmatic = true; const r = desc.set.call(this, v); setTimeout(()=>programmatic=false, 0); return r; }
    });

    // helper to reflect selection into UI without persisting
    async function reflectFromSheet() {
      const matName = sel.value;
      const op = await loadOpacityFor(matName);
      programmatic = true;
      range.value = String(op);
      // fire an input event so any visual binding updates, but ignore due to programmatic flag
      range.dispatchEvent(new Event('input', {bubbles:true}));
      setTimeout(()=>programmatic=false, 0);
      // also preview in scene to stay in sync visually
      applyOpacityByName(matName, op);
      log('reflected from sheet:', matName, op);
    }

    // --- Commit-mode wiring ---
    if (window.__LM_COMMIT_MODE) {
      log('wired panel (commit-mode)');

      // selection: reflect only
      sel.addEventListener('change', () => { reflectFromSheet(); });

      // input: preview only (no persist)
      let lastPreviewAt = 0;
      range.addEventListener('input', (ev)=>{
        if (programmatic) return; // ignore programmatic updates
        const now = performance.now();
        if (now - lastPreviewAt < 16) return; // ~60fps ceiling
        lastPreviewAt = now;
        applyOpacityByName(sel.value, range.value);
      });

      // change/blur: commit once
      let commitTimer = null;
      const scheduleCommit = ()=>{
        if (programmatic) return;
        if (commitTimer) clearTimeout(commitTimer);
        commitTimer = setTimeout(async ()=>{
          await persistOpacity(sel.value, range.value);
        }, 50);
      };
      range.addEventListener('change', scheduleCommit);
      range.addEventListener('blur', scheduleCommit);

      // first reflect for initial selection
      reflectFromSheet();
      return;
    }

    // --- Legacy wiring (if commit-mode is off) ---
    log('wired panel (legacy)');
    sel.addEventListener('change', async ()=>{
      const op = await loadOpacityFor(sel.value);
      range.value = String(op);
      applyOpacityByName(sel.value, op);
      await persistOpacity(sel.value, op); // legacy kept saving on select
    });
    range.addEventListener('input', ()=>{
      applyOpacityByName(sel.value, range.value);
      persistOpacity(sel.value, range.value);
    });
  }

  // Try wire once scene-ready or on DOM ready
  document.addEventListener('DOMContentLoaded', wirePanel);
  window.addEventListener('lm:scene-ready', wirePanel);
  // Also a delayed retry loop like existing logs indicate
  let tries = 0;
  (function retry(){
    tries++;
    if (tries>60) return;
    wirePanel();
    setTimeout(retry, 250);
  })();

  log('loaded VERSION_TAG: V6_15_COMMIT_MODE');
})();
