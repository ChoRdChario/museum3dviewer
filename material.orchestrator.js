
// material.orchestrator.js  (V6_15d)
// - Selection sync: when a material is selected, UI reflects saved values
// - Programmatic set guard to avoid accidental persists
// - Save only on change/pointerup with EPS threshold
(() => {
  const MOD = 'mat-orch';
  const EPS = 0.01;

  const ui = {
    ddl: null,
    perMatSlider: null,
  };

  const state = {
    programmaticSet: false,
    suppressPersist: false,
    currentKey: null,
  };

  function q(sel) { return document.querySelector(sel); }

  function clamp01(v){ v = Number(v); if (Number.isNaN(v)) return 1; return Math.min(1, Math.max(0, v)); }

  function setSliderSilently(v){
    state.programmaticSet = true;
    ui.perMatSlider.value = String(v);
    state.programmaticSet = false;
  }

  function applyOpacityToScene(materialKey, v){
    // The actual scene-update function is assumed to exist at window.viewerBridge.applyOpacityPerMaterial
    try {
      if (window.viewerBridge && typeof window.viewerBridge.applyOpacityPerMaterial === 'function') {
        window.viewerBridge.applyOpacityPerMaterial(materialKey, v);
      }
    } catch (e) {
      console.warn(`[${MOD}] applyOpacityToScene failed`, e);
    }
  }

  async function persist(materialKey, v){
    if (state.suppressPersist) return;
    if (!window.matSheet) return;
    const prev = window.matSheet.getOne(materialKey);
    if (prev && Math.abs(Number(prev.opacity ?? 1) - v) < EPS) return; // no-op
    await window.matSheet.upsertOne({
      materialKey,
      name: materialKey,
      opacity: v,
      updatedBy: 'ui'
    });
    console.log(`[${MOD}] persisted`, materialKey, v);
  }

  async function onSelectChange(){
    const key = ui.ddl.value || null;
    state.currentKey = key;
    if (!key) return;

    // 1) read saved value
    let saved = 1;
    const rec = window.matSheet && window.matSheet.getOne(key);
    if (rec && rec.opacity !== undefined) saved = clamp01(rec.opacity);

    // 2) first apply to scene, then reflect to UI (programmatic)
    state.suppressPersist = true;
    applyOpacityToScene(key, saved);
    setSliderSilently(saved);
    state.suppressPersist = false;
  }

  function onSliderInput(){
    if (!state.currentKey) return;
    const v = clamp01(ui.perMatSlider.value);
    // While dragging: reflect to scene only
    applyOpacityToScene(state.currentKey, v);
    // do not persist on input
  }

  function onSliderChange(){
    if (state.programmaticSet || !state.currentKey) return;
    const v = clamp01(ui.perMatSlider.value);
    persist(state.currentKey, v);
  }

  async function boot(){
    console.log(`[${MOD}] loaded VERSION_TAG: V6_15d_INIT_ORDER_FIX`);
    ui.ddl = q('[data-mat="select"]') || q('#lm-mat-select');
    ui.perMatSlider = q('[data-mat="per-opacity"]') || q('#lm-per-opacity');

    if (!ui.ddl || !ui.perMatSlider) {
      console.warn(`[${MOD}] UI controls not found`);
      return;
    }

    // Wire UI
    ui.ddl.addEventListener('change', onSelectChange);
    ui.perMatSlider.addEventListener('input', onSliderInput);
    ['change','pointerup','mouseup','touchend'].forEach(ev =>
      ui.perMatSlider.addEventListener(ev, onSliderChange)
    );

    // Wait a tick to ensure matSheet is ready, then prime cache from sheet
    setTimeout(async () => {
      try {
        if (window.matSheet) {
          await window.matSheet.loadAll().catch(()=>{});
        }
      } finally {
        console.log(`[${MOD}] overlay wired`);
      }
    }, 0);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
