/**
 * LociMyu: material.ui.pm-bridge.adapter.v4.js
 * - Map legacy #pm-* controls to orchestrator IDs (#materialSelect/#opacityRange).
 * - Populate materials from the loaded GLB scene.
 * - Filter out synthetic runtime materials (those auto-generated without a stable name).
 * - Apply opacity by material *name* (so clones share setting).
 * - Emit + persist changes via materialsSheetBridge when available.
 */
(function(){
  const LOG_PREFIX = "[pm-bridge v4]";
  const log  = (...a)=>console.log(LOG_PREFIX, ...a);
  const warn = (...a)=>console.warn(LOG_PREFIX, ...a);

  // Map ids immediately (no DOM restructure)
  const pmSel = document.getElementById('pm-material');
  const pmRng = document.getElementById('pm-opacity-range');
  const pmVal = document.getElementById('pm-opacity-val');
  if (pmSel && pmSel.id !== 'materialSelect') pmSel.id = 'materialSelect';
  if (pmRng && pmRng.id !== 'opacityRange')   pmRng.id = 'opacityRange';

  const sel = document.getElementById('materialSelect');
  const rng = document.getElementById('opacityRange');

  if (!sel || !rng) { warn("controls missing"); return; }

  // Keep numeric text in sync
  if (pmVal) {
    const upd = ()=> { try{ pmVal.textContent = Number(rng.value).toFixed(2); }catch(_){} };
    rng.addEventListener('input', upd);
    upd();
  }

  // Obtain scene robustly
  function getSceneLoose(){
    try {
      if (typeof getScene === 'function') { const s = getScene(); if (s) return s; }
    } catch(_){}
    return (window.__lm_scene || window.__lm_last_deep_scene || null);
  }

  // Material filter: allow only GLB-defined (named) materials; drop auto-labeled Mesh*Material #######
  function isRealGlbMaterial(m){
    if (!m) return false;
    if (!m.name || !m.name.trim()) return false;
    const name = m.name.trim();
    // Example of synthetic labels we saw: "MeshBasicMaterial 54a63836"
    if (/^Mesh[A-Za-z]+Material\s+[0-9a-f]{6,}$/i.test(name)) return false;
    return true;
  }

  function collectByName(scene){
    const map = new Map(); // name -> material
    if (!scene) return map;
    scene.traverse(o => {
      if (!o || !o.isMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats){
        if (!isRealGlbMaterial(m)) continue;
        if (!map.has(m.name)) map.set(m.name, m);
      }
    });
    return map;
  }

  function populate(scene){
    const mats = collectByName(scene);
    sel.innerHTML = "";
    for (const [name, m] of mats.entries()){
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      sel.appendChild(opt);
    }
    // If nothing, keep a placeholder
    if (!sel.options.length){
      const opt = document.createElement('option');
      opt.value = "";
      opt.textContent = "(no GLB materials)";
      sel.appendChild(opt);
    }
    log("materials populated", sel.options.length);
    return mats.size;
  }

  // Apply opacity by material name
  function applyOpacityByName(scene, matName, value){
    if (!matName) return;
    scene.traverse(o => {
      if (!o || !o.isMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats){
        if (!m || m.name !== matName) continue;
        m.transparent = (value < 1.0) || m.transparent;
        m.opacity = value;
        if ("needsUpdate" in m) m.needsUpdate = true;
      }
    });
  }

  // Debounce util (for Sheets writes)
  function debounce(fn, ms){
    let t; return (...args)=>{ clearTimeout(t); t=setTimeout(()=>fn(...args), ms); };
  }

  // Persist to Sheets if bridge exists; otherwise emit an event for outer layer
  const persistDebounced = debounce((payload)=>{
    const bridge = window.materialsSheetBridge;
    if (bridge){
      // Try common method names defensively
      const { materialKey, value } = payload;
      const fns = ["saveOpacity","upsertOpacity","setOpacity","writeOpacity"];
      const fn = fns.find(k => typeof bridge[k] === "function");
      if (fn){
        try {
          bridge[fn](materialKey, value);
          log("sheets persisted via", fn, payload);
          return;
        } catch(e){ warn("sheets persist error:", e); }
      }
    }
    // Fallback: broadcast an event
    window.dispatchEvent(new CustomEvent("lm:material-opacity-save", { detail: payload }));
    log("sheets persist deferred (event dispatched)", payload);
  }, 200);

  function wire(scene){
    // Select change -> apply current slider
    sel.addEventListener('change', ()=>{
      const name = sel.value;
      const v = parseFloat(rng.value);
      applyOpacityByName(scene, name, v);
      window.dispatchEvent(new CustomEvent("lm:material-opacity-changed", { detail: { materialKey: name, value: v } }));
      persistDebounced({ materialKey: name, value: v });
    });
    // Slider change -> apply to current selection
    rng.addEventListener('input', ()=>{
      const name = sel.value;
      const v = parseFloat(rng.value);
      applyOpacityByName(scene, name, v);
      window.dispatchEvent(new CustomEvent("lm:material-opacity-changed", { detail: { materialKey: name, value: v } }));
      persistDebounced({ materialKey: name, value: v });
    });
  }

  function boot(){
    const scene = getSceneLoose();
    if (!scene){
      // Wait for deep-ready once, then boot
      window.addEventListener("pm:scene-deep-ready", (e)=>{
        const s = e?.detail?.scene || null;
        if (!s) return;
        populate(s);
        wire(s);
        // Apply initial value immediately
        rng.dispatchEvent(new Event("input"));
      }, { once: true });
      return;
    }
    populate(scene);
    wire(scene);
    rng.dispatchEvent(new Event("input"));
  }

  boot();
})();