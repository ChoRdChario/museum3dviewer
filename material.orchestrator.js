// material.orchestrator.js
// Enumerate materials ONLY under the GLB model root to avoid caption/overlay layers
/* eslint-disable */
(() => {
  const LOG = false;
  const log = (...a)=> { if (LOG) console.debug('[mat-orch]', ...a); };

  const state = {
    inited: false,
    mode: 'auto',                 // 'key' | 'uuid'
    mapLabelToTargets: new Map(), // label => [ 'key:<materialKey>' | 'uuid:<material.uuid>' ]
    activeLabel: null,
    rafId: 0,
    ui: null,
    pollTimer: 0,
    pollCount: 0,
  };

  const raf = (fn) => {
    if (state.rafId) cancelAnimationFrame(state.rafId);
    state.rafId = requestAnimationFrame(()=>{ state.rafId=0; try{ fn(); }catch{} });
  };

  function escapeHtml(s){
    return String(s).replace(/[&<>"']/g, m => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[m]));
  }

  // ------- viewer / scene helpers -------
  function getSceneRoot(){
    return window.viewer?.getSceneRoot?.() || window.__LM_SCENE || window.scene || null;
  }
  function getModelRoot(){
    // 1) Prefer viewer API
    const viaViewer = window.viewer?.getModelRoot?.();
    if (viaViewer) return viaViewer;

    // 2) Heuristic: find a direct child marked by GLTFLoader or with many Meshes
    const root = getSceneRoot();
    if (!root) return null;
    let best = null;
    let bestCount = -1;
    for (const child of root.children || []) {
      // GLTFLoader marks scene root with userData.gltfAsset
      if (child?.userData?.gltfAsset) return child;
      // else score by number of Mesh descendants
      let count = 0;
      child.traverse((o)=>{ if (o.isMesh || o.type==='Mesh') count++; });
      if (count > bestCount) { bestCount = count; best = child; }
    }
    return best || root;
  }

  function traverseUnderModelRoot(fn){ // visits (obj, material, index)
    const root = getModelRoot();
    if (!root || !root.traverse) return 0;
    let n = 0;
    root.traverse((obj)=>{
      const m = obj && obj.material;
      if (!m) return;
      if (!(obj.isMesh || obj.type==='Mesh')) return;
      if (Array.isArray(m)) m.forEach((mm,i)=>{ n++; fn(obj, mm, i); });
      else { n++; fn(obj, m, 0); }
    });
    return n;
  }

  function listMaterialsSafe(){
    try {
      // If viewer provides listMaterials scoped to model, prefer it
      const arr = (window.viewer?.listMaterials?.() || []).filter(Boolean);
      return Array.isArray(arr) ? arr : [];
    } catch { return []; }
  }

  function enumerateUsingViewer(){
    const vlist = listMaterialsSafe();
    if (vlist.length === 0) return null;
    const modelRoot = getModelRoot();
    const modelSet = new Set();
    // Build a uuid set for materials under model root to filter viewer list
    traverseUnderModelRoot((obj, mat)=>{ modelSet.add(mat.uuid); });
    const map = new Map();
    for (const it of vlist) {
      const name = it?.name || '';
      const key  = it?.materialKey || '';
      const uuid = it?.uuid; // in case viewer exposes uuid
      if (uuid && !modelSet.has(uuid)) continue; // filter non-model materials
      const label = name ? name : (key ? `materialKey:${String(key).slice(-6)}` : 'material');
      if (!map.has(label)) map.set(label, []);
      if (key) map.get(label).push(`key:${String(key)}`);
    }
    if (map.size === 0) return null;
    return { mode: 'key', map };
  }

  function enumerateUsingUUID(){
    const byUuid = new Map(); // uuid => { label, uuids:Set }
    traverseUnderModelRoot((obj, mat)=>{
      const uuid = mat.uuid;
      const mname = mat.name || mat.userData?.name || '';
      const oname = obj.name || obj.userData?.name || '';
      const short = uuid ? uuid.slice(0,8) : Math.random().toString(36).slice(2,8);
      const label = mname ? mname : (oname ? `[${oname}] · ${short}` : `material:${short}`);
      if (!byUuid.has(uuid)) byUuid.set(uuid, { label, uuids: new Set() });
      byUuid.get(uuid).uuids.add(uuid);
    });
    if (byUuid.size === 0) return null;
    const map = new Map();
    for (const [, rec] of byUuid) {
      if (!map.has(rec.label)) map.set(rec.label, []);
      rec.uuids.forEach(u => map.get(rec.label).push(`uuid:${u}`));
    }
    return { mode: 'uuid', map };
  }

  function enumerateAuto(){
    const viaViewer = enumerateUsingViewer();
    if (viaViewer && viaViewer.map.size > 0) return viaViewer;
    const viaUuid = enumerateUsingUUID();
    if (viaUuid && viaUuid.map.size > 0) return viaUuid;
    return { mode: 'uuid', map: new Map() };
  }

  // ------- UI helpers -------
  function ensureUI(){
    let sel = document.getElementById('pm-material') || document.querySelector('#pm-material');
    let rng = document.getElementById('pm-opacity-range') || document.querySelector('#pm-opacity-range');
    let val = document.getElementById('pm-opacity-val') || document.querySelector('#pm-opacity-val');

    let rootTab = (sel && (sel.closest('.lm-tabpanel,[role="tabpanel"]') || document.getElementById('tab-material')))
               || document.querySelector('.lm-tabpanel#tab-material, [role="tabpanel"]#tab-material')
               || document.querySelector('.lm-tabpanel[data-panel="material"]')
               || document.querySelector('[role="tabpanel"][aria-labelledby="tabbtn-material"]');

    if (!sel || !rng) {
      if (!rootTab) return null;
      let mount = rootTab.querySelector('#mat-root');
      if (!mount) {
        mount = document.createElement('div');
        mount.id = 'mat-root';
        mount.style.display='flex'; mount.style.flexDirection='column'; mount.style.gap='.5rem';
        rootTab.appendChild(mount);
      }
      mount.innerHTML = `
        <div class="mat-row" style="display:flex;gap:.5rem;align-items:center;flex-wrap:wrap">
          <label for="pm-material">Material</label>
          <select id="pm-material" aria-label="material name" style="min-width:12rem"></select>
          <button id="pm-refresh" type="button" title="Refresh materials">↻</button>
        </div>
        <div class="mat-row" style="display:flex;gap:.5rem;align-items:center;flex-wrap:wrap">
          <label for="pm-opacity-range">Opacity</label>
          <input id="pm-opacity-range" type="range" min="0" max="1" step="0.01" value="1"/>
          <span id="pm-opacity-val" aria-live="polite">1.00</span>
        </div>
      `;
      sel = mount.querySelector('#pm-material');
      rng = mount.querySelector('#pm-opacity-range');
      val = mount.querySelector('#pm-opacity-val');
    } else {
      const hasRefresh = !!(sel.parentElement && sel.parentElement.querySelector('#pm-refresh'));
      if (!hasRefresh) {
        const btn = document.createElement('button');
        btn.id = 'pm-refresh'; btn.type = 'button'; btn.title = 'Refresh materials'; btn.textContent = '↻';
        sel.insertAdjacentElement('afterend', btn);
      }
    }
    const refresh = (rootTab || document).querySelector('#pm-refresh');
    return (state.ui = { rootTab: rootTab || document.body, sel, rng, val, refresh });
  }

  function fillSelect(){
    const { sel } = state.ui;
    const labels = [...state.mapLabelToTargets.keys()].sort((a,b)=>a.localeCompare(b));
    if (labels.length === 0) {
      sel.innerHTML = `<option value="">— Select material —</option>`;
      state.activeLabel = null;
      return;
    }
    const prev = state.activeLabel;
    sel.innerHTML = labels.map(lb=>`<option value="${escapeHtml(lb)}">${escapeHtml(lb)}</option>`).join('');
    if (prev && labels.includes(prev)) sel.value = prev;
    else { sel.selectedIndex = 0; state.activeLabel = sel.value || labels[0] || null; }
  }

  function applyOpacityToActive(opacity){
    const label = state.activeLabel;
    if (!label) return;
    const targets = state.mapLabelToTargets.get(label) || [];
    const apply = window.viewer?.applyMaterialProps;

    for (const t of targets) {
      if (t.startsWith('key:') && typeof apply === 'function') {
        const key = t.slice(4);
        apply(key, { opacity });
      } else if (t.startsWith('uuid:')) {
        const uuid = t.slice(5);
        traverseUnderModelRoot((obj, mat)=>{
          if (mat.uuid !== uuid) return;
          mat.transparent = (opacity < 1);
          mat.opacity = opacity;
          mat.needsUpdate = true;
        });
      }
    }
  }

  // ------- polling / enumerate -------
  function enumerateAndFill(){
    const res = enumerateAuto();
    state.mode = res.mode;
    state.mapLabelToTargets = res.map;
    fillSelect();
  }

  function startPolling(){
    stopPolling();
    state.pollCount = 0;
    const doPoll = () => {
      state.pollCount++;
      enumerateAndFill();
      if (state.mapLabelToTargets.size > 0 && state.pollCount > 40) {
        stopPolling();
      } else if (state.pollCount > 75) {
        stopPolling();
      } else {
        state.pollTimer = setTimeout(doPoll, 400);
      }
    };
    doPoll();
  }
  function stopPolling(){
    if (state.pollTimer) { clearTimeout(state.pollTimer); state.pollTimer = 0; }
  }

  // ------- init -------
  function wireHandlers(){
    const ui = state.ui;
    ui.sel.addEventListener('change', ()=>{
      state.activeLabel = ui.sel.value || null;
      const v = +ui.rng.value || 1;
      raf(()=>applyOpacityToActive(v));
    });
    ui.rng.addEventListener('input', ()=>{
      const v = +ui.rng.value || 1;
      ui.val && (ui.val.textContent = v.toFixed(2));
      raf(()=>applyOpacityToActive(v));
    });
    ui.refresh?.addEventListener('click', ()=>{
      enumerateAndFill();
      const v = +ui.rng.value || 1;
      raf(()=>applyOpacityToActive(v));
      startPolling();
    });

    const tabBtn = document.getElementById('tabbtn-material') || document.querySelector('[role="tab"][aria-controls="tab-material"]');
    tabBtn?.addEventListener('click', ()=> setTimeout(()=>{
      enumerateAndFill();
    }, 0));
  }

  function initOnce(){
    if (state.inited) return;
    state.inited = true;
    const ui = ensureUI();
    if (!ui) return;
    state.ui = ui;

    enumerateAndFill();
    wireHandlers();
    startPolling();

    const initOp = +ui.rng.value || 1;
    ui.val && (ui.val.textContent = initOp.toFixed(2));
    raf(()=>applyOpacityToActive(initOp));
  }

  if (document.readyState !== 'loading') setTimeout(initOnce, 0);
  window.addEventListener('lm:model-ready', initOnce, { once: true });
  window.addEventListener('lm:scene-ready', initOnce, { once: true });
  setTimeout(initOnce, 1500);
})();
