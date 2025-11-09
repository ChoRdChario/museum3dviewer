/**
 * materials.sheet.hydrate.js
 * v1.0
 *
 * Purpose:
 * - When a caption sheet (spreadsheetId/gid) is selected (lm:sheet-context),
 *   load __LM_MATERIALS into a local cache and apply values to the scene.
 * - Keep UI (opacity/doubleSided/unlitLike) in sync on material selection.
 *
 * Events listened:
 * - lm:sheet-context  -> load cache from Sheets (create if missing), emit lm:materials-ready
 * - lm:model-ready    -> re-apply from cache to all meshes/materials (idempotent)
 * - lm:mat-apply      -> (optional external) {key, values} to force re-apply
 */
(function(){
  const LOG_PREFIX = '[mat-hydrate v1.0]';
  const MAT_SHEET = '__LM_MATERIALS';

  const state = {
    ctx: null,     // { spreadsheetId, sheetGid }
    cache: new Map(), // key -> { opacity, doubleSided, unlitLike, updatedAt, updatedBy, ... }
    ready: false,
  };

  function log(...a){ console.log(LOG_PREFIX, ...a); }
  function warn(...a){ console.warn(LOG_PREFIX, ...a); }

  // Utility: authorized fetch with auto-JSON
  async function fetchJSONAuth(url, init={}){
    const fn = window.__lm_fetchJSONAuth;
    if (typeof fn !== 'function') throw new Error('__lm_fetchJSONAuth missing');
    return await fn(url, init);
  }

  // Ensure sheet and headers exist
  async function ensureSheetAndHeaders(spreadsheetId){
    // 1) ensure sheet exists
    const meta = await fetchJSONAuth(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`);
    const titles = (meta.sheets||[]).map(s=>s.properties.title);
    if (!titles.includes(MAT_SHEET)){
      await fetchJSONAuth(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
        { method:'POST', body:{ requests:[{ addSheet:{ properties:{ title: MAT_SHEET } } }] } }
      );
      log('added sheet:', MAT_SHEET);
    }
    // 2) ensure headers A:M
    const headers = [
      'materialKey','opacity','doubleSided','unlitLike',
      'chromaEnable','chromaColor','chromaTolerance','chromaFeather',
      'roughness','metalness','emissiveHex',
      'updatedAt','updatedBy'
    ];
    await fetchJSONAuth(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(MAT_SHEET+'!A1:M1')}?valueInputOption=RAW`,
      { method:'PUT', body:{ values:[headers] } }
    );
  }

  // Load all rows into cache (A2:M)
  async function loadCache(spreadsheetId){
    state.cache.clear();
    const range = encodeURIComponent(`${MAT_SHEET}!A2:M`);
    const res = await fetchJSONAuth(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}`
    );
    const rows = res.values || [];
    rows.forEach(row => {
      const [
        materialKey, opacity, doubleSided, unlitLike,
        chromaEnable, chromaColor, chromaTolerance, chromaFeather,
        roughness, metalness, emissiveHex,
        updatedAt, updatedBy
      ] = row;
      if (!materialKey) return;
      state.cache.set(materialKey, {
        opacity: (opacity === '' || opacity === undefined) ? null : Number(opacity),
        doubleSided: String(doubleSided).toUpperCase() === 'TRUE',
        unlitLike:   String(unlitLike).toUpperCase() === 'TRUE',
        chromaEnable: String(chromaEnable).toUpperCase() === 'TRUE',
        chromaColor: chromaColor || '',
        chromaTolerance: chromaTolerance ? Number(chromaTolerance) : null,
        chromaFeather:   chromaFeather ? Number(chromaFeather) : null,
        roughness: roughness || '',
        metalness: metalness || '',
        emissiveHex: emissiveHex || '',
        updatedAt: updatedAt || '',
        updatedBy: updatedBy || '',
      });
    });
    log('cache loaded keys:', state.cache.size);
  }

  // Apply cached values to all scene materials
  function applyAllFromCache(){
    const scene = window.__LM_SCENE || window.scene;
    if (!scene){ warn('scene not present'); return; }
    let applied = 0;
    scene.traverse(o=>{
      if (!o.isMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach(m=>{
        if (!m) return;
        const key = m.name || o.name;
        const v = state.cache.get(key);
        if (!v) return;
        // Opacity
        if (v.opacity != null && !isNaN(v.opacity)){
          m.opacity = v.opacity;
          m.transparent = v.opacity < 0.999;
        }
        // Double-sided
        m.side = v.doubleSided ? (window.THREE?.DoubleSide ?? 2) : (window.THREE?.FrontSide ?? 0);
        // Unlit-like (simple approx)
        if (v.unlitLike){
          if (m.isMeshStandardMaterial || m.isMeshPhysicalMaterial){
            m.uniformsNeedUpdate = true;
            m.userData.__lm_unlitLike = true;
          }
        }else{
          if (m.userData) delete m.userData.__lm_unlitLike;
        }
        m.needsUpdate = true;
        applied++;
      });
    });
    log('applied materials from cache:', applied);
    window.dispatchEvent(new CustomEvent('lm:materials-ready', { detail:{ size: state.cache.size } }));
  }

  // Reflect current selection into UI (if present)
  function reflectSelectionUI(){
    const sel = document.querySelector('#pm-material');
    if (!sel) return;
    const key = sel.value || sel.selectedOptions?.[0]?.value || '';
    if (!key) return;
    const v = state.cache.get(key);
    if (!v) return;
    const rng = document.querySelector('#pm-opacity-range');
    const ds  = document.querySelector('#pm-double-sided');
    const un  = document.querySelector('#pm-unlit-like');
    if (rng && v.opacity != null && !isNaN(v.opacity)) rng.value = String(v.opacity);
    if (ds) ds.checked = !!v.doubleSided;
    if (un) un.checked = !!v.unlitLike;
  }

  // Event: caption sheet context
  window.addEventListener('lm:sheet-context', async (e)=>{
    try{
      const detail = e.detail || {};
      const { spreadsheetId, sheetGid } = detail;
      if (!spreadsheetId){ warn('no spreadsheetId in sheet-context'); return; }
      state.ctx = { spreadsheetId, sheetGid };
      await ensureSheetAndHeaders(spreadsheetId);
      await loadCache(spreadsheetId);
      applyAllFromCache();
      reflectSelectionUI();
      state.ready = true;
    }catch(err){
      warn('hydrate failed', err);
    }
  });

  // Event: model ready -> re-apply from cache
  window.addEventListener('lm:model-ready', ()=>{
    if (!state.ready) return;
    applyAllFromCache();
    reflectSelectionUI();
  });

  // Optional: external material apply request
  window.addEventListener('lm:mat-apply', (e)=>{
    if (!state.ready) return;
    const d = e.detail || {};
    if (d && d.key){
      const cur = state.cache.get(d.key) || {};
      const next = Object.assign({}, cur, d.values || {});
      state.cache.set(d.key, next);
    }
    applyAllFromCache();
    reflectSelectionUI();
  });

  // Expose read API
  window.__LM_MAT_CACHE = {
    get: (key)=> state.cache.get(key),
    has: (key)=> state.cache.has(key),
    keys: ()=> Array.from(state.cache.keys()),
    ctx: ()=> state.ctx,
  };

  log('armed');
})();