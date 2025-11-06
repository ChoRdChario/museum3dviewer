// material.ui.pm-bridge.adapter.v3.js
// LociMyu PM Bridge v3
// - ID map: #pm-material -> #materialSelect, #pm-opacity-range -> #opacityRange
// - Populate with authored materials (with .name) first, dedupe by UUID and name
// - Live numeric readout next to the range
// - Apply opacity to selected material across meshes
// - Persist per-sheet via materialsSheetBridge when available (best-effort)
// - Also emits 'lm:material-opacity-changed' CustomEvent for other listeners
// - Debounced saves; safe to load multiple times (idempotent)

(function(){
  const NS='[pm-bridge v3]';
  if (window.__lm_pm_bridge_v3) return;
  window.__lm_pm_bridge_v3 = true;
  const log=(...a)=>console.log(NS, ...a);
  const warn=(...a)=>console.warn(NS, ...a);

  // --- utilities ---
  const debounce = (fn, ms=300)=>{
    let t; return (...args)=>{ clearTimeout(t); t=setTimeout(()=>fn(...args), ms); };
  };
  const by = (k)=>(a,b)=> (a[k]||'').localeCompare(b[k]||'');

  function renameId(el, targetId){
    if (!el) return null;
    try{
      if (el.id !== targetId){
        el.setAttribute('data-orig-id', el.id||'');
        el.id = targetId;
      }
      return el;
    }catch(e){ warn('renameId failed', e); return null; }
  }

  function removeAutoPanels(){
    document.getElementById('lm-material-panel-autogen')?.remove();
    document.querySelectorAll('[data-lm-autogen="material-panel"]').forEach(n=>n.remove());
  }

  function ensureValueLabel(rng){
    let label = rng?.nextElementSibling;
    // If next sibling isn't our label, create one
    if (!label || !label.matches('.lm-opacity-value')){
      label = document.createElement('span');
      label.className = 'lm-opacity-value';
      label.style.cssText = 'margin-left:8px;min-width:42px;display:inline-block;text-align:right;opacity:.8;font-variant-numeric:tabular-nums';
      rng?.parentElement?.insertBefore(label, rng.nextSibling);
    }
    return label;
  }

  function getSceneLoose(){
    try{
      if (typeof getScene==='function'){
        const s = getScene();
        if (s) return s;
      }
    }catch{}
    return window.__lm_scene || null;
  }

  function collectMaterials(scene){
    const seen = new Set();
    const list = [];
    scene?.traverse(obj=>{
      if (!obj?.isMesh) return;
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const m of mats){
        if (!m) continue;
        if (seen.has(m.uuid)) continue;
        seen.add(m.uuid);
        list.push({ uuid: m.uuid, name: (m.name||'').trim(), type: m.type||'Material', ref: m });
      }
    });
    // Stable ordering: named first (alphabetical), then unnamed by type/uuid
    const named = list.filter(x=>x.name);
    const anon  = list.filter(x=>!x.name);
    named.sort(by('name'));
    anon.sort(by('type'));
    return [...named, ...anon];
  }

  function populateSelect(sel, mats){
    sel.innerHTML = '';
    if (!mats.length){
      const opt = document.createElement('option');
      opt.value = ''; opt.textContent = '(no materials found)';
      sel.appendChild(opt);
      return;
    }
    for (const m of mats){
      const opt = document.createElement('option');
      opt.value = m.uuid;
      opt.textContent = m.name || `${m.type} ${m.uuid.slice(0,8)}`;
      opt.dataset.type = m.type;
      sel.appendChild(opt);
    }
  }

  function applyOpacity(scene, targetUuid, value){
    if (!scene || !targetUuid) return;
    scene.traverse(o=>{
      if (!o?.isMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats){
        if (!m || m.uuid !== targetUuid) continue;
        m.transparent = (value < 1.0) || m.transparent;
        m.opacity = value;
        if ('needsUpdate' in m) m.needsUpdate = true;
      }
    });
  }

  // Best-effort persist via materialsSheetBridge, probing common method names
  const persistOpacity = debounce((materialKey, value)=>{
    try{
      const b = window.materialsSheetBridge || window.materialsSheet || window.__lm_materialsSheetBridge;
      if (b){
        const fns = [
          'saveOpacity','setOpacity','putOpacity','upsertOpacity','setPerMaterialOpacity','savePerMaterialOpacity'
        ];
        for (const fn of fns){
          if (typeof b[fn] === 'function'){
            b[fn](materialKey, value);
            log('persist via bridge', fn, materialKey, value);
            return;
          }
        }
      }
    }catch(e){ warn('persistOpacity error', e); }
    // Fire an event so orchestrators can handle the save
    try{
      window.dispatchEvent(new CustomEvent('lm:material-opacity-changed', {
        detail: { materialKey, value }
      }));
      log('emitted lm:material-opacity-changed', { materialKey, value });
    }catch(e){}
  }, 300);

  function boot(){
    const sel0 = document.getElementById('pm-material') 
              || document.querySelector('#pm-material, select[aria-label="Select material"]');
    const rng0 = document.getElementById('pm-opacity-range') 
              || document.querySelector('#pm-opacity-range, input[type="range"][aria-label="Opacity"]');
    const sel = renameId(sel0 || document.getElementById('materialSelect'), 'materialSelect');
    const rng = renameId(rng0 || document.getElementById('opacityRange'), 'opacityRange');
    if (!sel || !rng){ warn('controls missing'); return; }

    removeAutoPanels();

    const scene = getSceneLoose();
    const mats  = collectMaterials(scene);
    populateSelect(sel, mats);

    // Live numeric label
    const label = ensureValueLabel(rng);
    const updateLabel = ()=>{ label.textContent = (parseFloat(rng.value)||0).toFixed(2); };
    rng.addEventListener('input', updateLabel);
    updateLabel();

    function applyAndSave(){
      const uuid = sel.value;
      const v = parseFloat(rng.value)||0;
      applyOpacity(scene, uuid, v);
      // Persist: prefer material name if present, fall back to uuid
      const recordKey = mats.find(m=>m.uuid===uuid)?.name || uuid;
      persistOpacity(recordKey, v);
    }

    rng.addEventListener('input', applyAndSave);
    sel.addEventListener('change', ()=>{
      // When material changes, immediately reflect current v
      applyAndSave();
    });

    // Kick initial application to selected item (if any)
    applyAndSave();

    // Let others know we are bound
    try{
      window.dispatchEvent(new CustomEvent('lm:pm-bridge-ready', { detail:{ count: mats.length }}));
    }catch{}

    log('ready', { materials: mats.length });
  }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', boot, { once:true });
  } else {
    boot();
  }
})();