/* LociMyu: material.orchestrator.js (UI-detect fix A3.2)
 * - Relaxed UI detection: "material select present" is sufficient (others optional)
 * - Scoped DOM search to Material tab/panel to avoid collisions
 * - Broadened selectors (supports #pm-material / aria-label / name*="material" / id*="material")
 * - Populates material select once scene is ready and UI appears
 * - GLB-only material list (filters MeshBasicMaterial with empty name)
 * - Selection loads sheet row and applies ONLY TO UI (no save on select)
 * - UI edits apply to scene + debounced save to sheet (if optional controls exist)
 */

(function(){
  const TAG = '[mat-orch]';
  const VERSION = 'A3.2_UI_SCOPE_RELAX';

  // --- safe loggers ---
  const log = (...a)=>console.log(TAG, ...a);
  const warn = (...a)=>console.warn(TAG, ...a);
  const err =  (...a)=>console.error(TAG, ...a);

  log('boot', VERSION);

  // --- bridges / globals ---
  const br = window.__LM_VIEWER_BRIDGE__ || window.LM_VIEWER_BRIDGE || window.viewerBridge || null;
  if (!br) warn('viewer-bridge not found on window (yet)');

  const sheetBridge = window.__LM_MATERIALS_SHEET__ || window.materialsSheetBridge || window.MATERIALS_SHEET_BRIDGE || null;
  if (!sheetBridge) warn('materialsSheetBridge not found on window (yet)');

  // --- state ---
  const state = {
    sceneReady: false,
    scene: null,
    ui: {
      root: null,
      select: null,
      opacity: null,
      doubleSided: null,
      unlit: null,
    },
    currentKey: null,
    suppressUI: false,
    saveTimer: null,
    materialIndex: [], // {key,label,name,uuid,mesh,type,_ref}
  };

  // --- helpers ---
  function until(ms){ return new Promise(r=>setTimeout(r,ms)); }

  // Deep query (shadow DOM aware) scoped to a root node
  function qsAllDeep(root, sel){
    const out = [];
    const walk = (node)=>{
      if (!node) return;
      try{ node.querySelectorAll(sel).forEach(n=>out.push(n)); }catch{}
      const kids = node.children || [];
      for (const k of kids){
        if (k.shadowRoot) walk(k.shadowRoot);
        walk(k);
      }
    };
    walk(root);
    return out;
  }

  // Try to find a reasonable root for the "Material" tab panel
  function findMaterialRoot(){
    // common patterns
    const candidates = [
      '[data-tab="material"]',
      '#panel-material',
      '[role="tabpanel"][id*="material" i]',
      '[id*="panel"][id*="material" i]',
      // fallback to any element that contains our known header label
      // (cheap check to narrow scope)
      null,
    ];
    for (const sel of candidates){
      if (!sel) break;
      const el = document.querySelector(sel);
      if (el) return el;
    }
    // very last resort: whole document
    return document.body || document.documentElement;
  }

  function findUI(){
    const root = findMaterialRoot();
    state.ui.root = root;

    // Broadened selector set for the select
    const selectCand = [
      '#pm-material',
      '#materialSelect', '#mat-select', '#matKeySelect',
      'select[aria-label="Select material"]',
      'select[name="material" i]',
      'select[id*="material" i]',
      'select',
    ];

    const rangeCand = ['#opacityRange', '#matOpacity', 'input[type="range"]'];
    const dsCand    = ['#doubleSided', '#matDoubleSided', 'input[type="checkbox"][name*="double" i]'];
    const unCand    = ['#unlit', '#matUnlit', 'input[type="checkbox"][name*="unlit" i]'];

    const pickFirst = (cands)=>{
      for (const sel of cands){
        const list = qsAllDeep(root, sel);
        if (list.length) return list[0];
      }
      return null;
    };

    const select = pickFirst(selectCand);
    const opacity = pickFirst(rangeCand);
    const doubleSided = pickFirst(dsCand);
    const unlit = pickFirst(unCand);

    state.ui.select = select;
    state.ui.opacity = opacity || null;
    state.ui.doubleSided = doubleSided || null;
    state.ui.unlit = unlit || null;

    // Relax: select が存在すれば UI 検出成功とみなす
    const ok = !!select;
    if (!ok) return false;

    // 視認性（非表示）も警告として出すだけで失敗にしない
    try{
      const vis = !!(select && select.ownerDocument && select.getClientRects().length &&
                     getComputedStyle(select).display !== 'none' &&
                     getComputedStyle(select).visibility !== 'hidden');
      if (!vis) warn('select is present but invisible (tab may be collapsed)');
    }catch{}

    return true;
  }

  function startUIDetector(){
    let tries = 0;
    const tick = setInterval(()=>{
      tries++;
      if (findUI()) {
        clearInterval(tick);
        if (mo) mo.disconnect();
        log('UI found via interval', state.ui);
        onUIReady();
      } else if (tries % 10 === 0) {
        log('UI still not found; keep idle');
      }
      // Stop after 2 minutes
      if (tries > 120) clearInterval(tick);
    }, 1000);

    const mo = new MutationObserver(()=>{
      if (findUI()) {
        if (tick) clearInterval(tick);
        mo.disconnect();
        log('UI found via MutationObserver', state.ui);
        onUIReady();
      }
    });
    mo.observe(document.documentElement || document.body, { childList:true, subtree:true });
  }

  function getScene(){
    try {
      const s = (br && typeof br.getScene === 'function') ? br.getScene() : null;
      if (s && typeof s.traverse === 'function') return s;
    } catch(e){ /* noop */ }
    return null;
  }

  function listGLBMaterials(scene){
    const list = [];
    scene.traverse(obj => {
      if (!obj || !obj.isMesh) return;
      if (obj.isSprite || obj.isPoints || obj.isLine) return;
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      mats.forEach((m,i)=>{
        if (!m) return;
        const rawName = (m.name || '').trim();
        const isOverlayBasic = (m.type === 'MeshBasicMaterial' && !rawName);
        if (isOverlayBasic) return; // overlay-ish generated material; ignore
        const uuid = m.uuid || m.id || null;
        const label = rawName || (obj.name ? `${obj.name} (${m.type||'Material'})` : `${m.type||'Material'} ${i+1}`);
        list.push({
          key: uuid || rawName || `${obj.uuid}:${i}`,
          label,
          name: rawName || null,
          uuid: uuid || null,
          mesh: obj.name || null,
          type: m.type || null,
          _ref: m,
        });
      });
    });
    const seen = new Set();
    const uniq = list.filter(r=>r.key && !seen.has(r.key) && seen.add(r.key));
    uniq.sort((a,b)=> (a.label||'').localeCompare(b.label||'') || (a.mesh||'').localeCompare(b.mesh||''));
    return uniq;
  }

  function populateSelect(){
    const sel = state.ui.select;
    if (!sel) return;
    sel.innerHTML = '';
    for (const r of state.materialIndex){
      const opt = document.createElement('option');
      opt.value = r.key;
      opt.textContent = r.label || r.key;
      sel.appendChild(opt);
    }
    if (state.currentKey){
      const found = state.materialIndex.find(r=>r.key===state.currentKey);
      if (found) sel.value = state.currentKey;
    }
  }

  function getMaterialByKey(key){
    return state.materialIndex.find(r=>r.key===key) || null;
  }

  // --- sheet sync (read on select; write only on edit) ---
  async function loadSheetRow(materialKey){
    if (!sheetBridge || typeof sheetBridge.loadAll !== 'function') return null;
    try {
      const rows = await sheetBridge.loadAll();
      if (!Array.isArray(rows)) return null;
      const row = rows.find(r => String(r.materialKey || r.key || '').trim() === String(materialKey));
      return row || null;
    } catch(e){
      warn('sheet loadAll error', e);
      return null;
    }
  }

  function uiSet(values){
    const {opacity, doubleSided, unlit} = state.ui;
    state.suppressUI = true;
    if (opacity && typeof values.opacity === 'number') opacity.value = String(values.opacity);
    if (doubleSided && typeof values.doubleSided === 'boolean') doubleSided.checked = values.doubleSided;
    if (unlit && typeof values.unlit === 'boolean') unlit.checked = values.unlit;
    Promise.resolve().then(()=>{ state.suppressUI = false; });
  }

  function applyToScene(materialKey, values){
    const rec = getMaterialByKey(materialKey);
    if (!rec || !rec._ref) return;
    const m = rec._ref;
    if (typeof values.opacity === 'number'){
      if ('transparent' in m) m.transparent = (values.opacity < 1);
      if ('opacity' in m) m.opacity = values.opacity;
      if (m.needsUpdate !== undefined) m.needsUpdate = true;
    }
    if (typeof values.doubleSided === 'boolean'){
      if ('side' in m) m.side = values.doubleSided ? (window.THREE && THREE.DoubleSide || 2) : (window.THREE && THREE.FrontSide || 0);
      if (m.needsUpdate !== undefined) m.needsUpdate = true;
    }
    if (typeof values.unlit === 'boolean'){
      m.userData = m.userData || {};
      m.userData.__lm_unlit = !!values.unlit;
    }
  }

  function debouncedSave(materialKey, values){
    if (!sheetBridge || typeof sheetBridge.upsertOne !== 'function') return;
    if (state.saveTimer) clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(async ()=>{
      try {
        await sheetBridge.upsertOne(Object.assign({ materialKey }, values));
        log('saved', { materialKey, values });
      } catch(e){
        warn('upsertOne failed', e);
      }
    }, 500);
  }

  // --- UI wiring ---
  async function onMaterialChange(){
    const sel = state.ui.select;
    const key = sel && sel.value;
    state.currentKey = key || null;
    if (!key) return;

    const row = await loadSheetRow(key);
    if (row){
      const vals = {
        opacity: (typeof row.opacity === 'number') ? row.opacity :
                 (row.opacity != null ? Number(row.opacity) : undefined),
        doubleSided: (typeof row.doubleSided === 'boolean') ? row.doubleSided :
                     (row.doubleSided != null ? (String(row.doubleSided).toLowerCase() === 'true') : undefined),
        unlit: (typeof row.unlit === 'boolean') ? row.unlit :
               (row.unlit != null ? (String(row.unlit).toLowerCase() === 'true') : undefined),
      };
      uiSet(vals);
    } else {
      const rec = getMaterialByKey(key);
      const m = rec && rec._ref;
      if (m){
        const vals = {
          opacity: (typeof m.opacity === 'number') ? m.opacity : 1,
          doubleSided: (('side' in m) ? (m.side === (window.THREE && THREE.DoubleSide || 2)) : false),
          unlit: !!(m.userData && m.userData.__lm_unlit),
        };
        uiSet(vals);
      }
    }
  }

  function onUIEdited(){
    if (state.suppressUI) return;
    const key = state.currentKey;
    if (!key) return;
    const o  = state.ui.opacity ? Number(state.ui.opacity.value) : undefined;
    const ds = state.ui.doubleSided ? !!state.ui.doubleSided.checked : undefined;
    const un = state.ui.unlit ? !!state.ui.unlit.checked : undefined;
    const vals = {};
    if (Number.isFinite(o)) vals.opacity = Math.min(1, Math.max(0, o));
    if (typeof ds === 'boolean') vals.doubleSided = ds;
    if (typeof un === 'boolean') vals.unlit = un;
    applyToScene(key, vals);
    debouncedSave(key, vals);
  }

  function bindUIHandlers(){
    const { select, opacity, doubleSided, unlit } = state.ui;
    if (select) select.addEventListener('change', onMaterialChange);
    if (opacity) opacity.addEventListener('input', onUIEdited);
    if (doubleSided) doubleSided.addEventListener('change', onUIEdited);
    if (unlit) unlit.addEventListener('change', onUIEdited);
  }

  async function onUIReady(){
    if (!state.sceneReady) {
      bindUIHandlers();
      return;
    }
    state.materialIndex = listGLBMaterials(state.scene);
    populateSelect();
    bindUIHandlers();
    log('UI initialized with materials:', state.materialIndex.length);
  }

  async function onSceneReady(){
    state.scene = getScene();
    state.sceneReady = !!state.scene;
    if (!state.sceneReady) {
      warn('scene-ready observed but getScene() returned null');
      return;
    }
    log('scene-ready observed');
    if (state.ui.select) {
      state.materialIndex = listGLBMaterials(state.scene);
      populateSelect();
      bindUIHandlers();
      log('materials populated on scene-ready:', state.materialIndex.length);
    }
  }

  // --- bootstrap ---
  (function bootstrap(){
    window.addEventListener('lm:scene-ready', onSceneReady, { once:false });

    const maybeScene = getScene();
    if (maybeScene) {
      state.scene = maybeScene;
      state.sceneReady = true;
      log('scene was already available at boot');
    }

    startUIDetector();
  })();

})();


// ---- LociMyu patch: ensure Material UI exists (auto-inject if missing) ----
function __lm_ensureMaterialUI(){
  try{
    let sel = document.getElementById('materialSelect');
    let rng = document.getElementById('opacityRange');
    if (sel && rng) return { sel, rng };
    // Try to locate a right pane container
    let right = document.getElementById('right') || document.querySelector('#right, .right, aside') || document.body;
    const panelId = 'lm-material-panel-autogen';
    let panel = document.getElementById(panelId);
    if (!panel){
      panel = document.createElement('div');
      panel.id = panelId;
      panel.className = 'panel';
      panel.style.margin = '12px 0';
      panel.style.padding = '12px';
      panel.style.border = '1px solid #2a2f36';
      panel.style.borderRadius = '10px';
      panel.innerHTML = `
        <h4 style="margin:0 0 8px">Material</h4>
        <label style="display:block;margin:8px 0 6px;font-size:12px;opacity:.8">Select</label>
        <select id="materialSelect" style="width:100%;padding:6px;background:#1a1d21;color:#e6e6e6;border:1px solid #2a2f36;border-radius:8px"></select>
        <label for="opacityRange" style="display:block;margin:12px 0 6px;font-size:12px;opacity:.8">Opacity</label>
        <input id="opacityRange" type="range" min="0" max="1" step="0.01" value="1" style="width:100%">
      `;
      right.prepend(panel);
    }
    sel = document.getElementById('materialSelect');
    rng = document.getElementById('opacityRange');
    return { sel, rng };
  }catch(e){
    console.warn('[mat-orch] auto-inject UI failed', e);
    return { sel: null, rng: null };
  }
}


// ---- LociMyu patch: deep-ready listener with UI ensure ----
(function __lm_installDeepReadyListener2(){
  if (window.__lm_mat_orch_ready_listener2_installed) return;
  window.__lm_mat_orch_ready_listener2_installed = true;
  window.addEventListener('pm:scene-deep-ready', (e) => {
    try{
      console.log('[mat-orch] pm:scene-deep-ready (auto)', !!(e && e.detail && e.detail.scene));
      const ui = __lm_ensureMaterialUI();
      if (typeof populateSelect === 'function') populateSelect();
      if (typeof bindUIHandlers === 'function') bindUIHandlers();
      // Fallback handlers if not present
      if (typeof populateSelect !== 'function' && window.THREE && e?.detail?.scene && ui.sel){
        // build basic material list
        const mats = new Map();
        e.detail.scene.traverse(obj => {
          if (obj.isMesh && obj.material){
            const arr = Array.isArray(obj.material) ? obj.material : [obj.material];
            for(const m of arr){ if (m && m.uuid) mats.set(m.uuid, m); }
          }
        });
        ui.sel.innerHTML = '';
        for(const m of mats.values()){
          const opt = document.createElement('option');
          opt.value = m.uuid; opt.textContent = m.name || m.uuid.slice(0,8);
          ui.sel.appendChild(opt);
        }
      }
      if (typeof bindUIHandlers !== 'function' && e?.detail?.scene){
        const ui = __lm_ensureMaterialUI();
        if (ui.sel && ui.rng){
          ui.rng.addEventListener('input', () => {
            const targetUuid = ui.sel.value;
            if (!targetUuid) return;
            e.detail.scene.traverse(obj => {
              if (obj.isMesh && obj.material){
                const arr = Array.isArray(obj.material) ? obj.material : [obj.material];
                for(const m of arr){ if (m && m.uuid === targetUuid){ m.transparent = true; m.opacity = parseFloat(ui.rng.value); } }
              }
            });
          });
        }
      }
    }catch(err){ console.warn('[mat-orch] deep-ready handler error', err); }
  });
})();    

