// === material.orchestrator.js (V6_12g_ENUM_ROBUST) ===========================
(function(){
  const VER = 'V6_12g_ENUM_ROBUST';
  const NS  = '[mat-orch]';
  const log = (...a)=>console.log(NS, ...a);
  const warn= (...a)=>console.warn(NS, ...a);
  log('loaded VERSION_TAG:'+VER);

  const st = (window.__lm_materialState = window.__lm_materialState || {
    spreadsheetId:null, sheetGid:null, modelKey:null, currentMaterialKey:null
  });

  function onSheetCtx(ev){
    const d = ev && ev.detail || {};
    if (d.spreadsheetId) st.spreadsheetId = d.spreadsheetId;
    if (typeof d.sheetGid !== 'undefined') st.sheetGid = d.sheetGid;
    log('sheet context set', {spreadsheetId:st.spreadsheetId, sheetGid:st.sheetGid});
  }
  window.addEventListener('lm:sheet-context', onSheetCtx);
  document.addEventListener('lm:sheet-context', onSheetCtx);

  async function listMaterialsRobust(){
    try{
      const b = (window.viewerBridge && typeof window.viewerBridge.listMaterials==='function')
        ? window.viewerBridge.listMaterials() : [];
      if (Array.isArray(b) && b.length) return b;
    }catch(_){}

    try{
      const scene = (window.viewerBridge && window.viewerBridge.getScene && window.viewerBridge.getScene())
                 || (window.__lm_getScene && window.__lm_getScene())
                 || (window.__lm_viewer && window.__lm_viewer.scene)
                 || (window.viewer && window.viewer.scene)
                 || null;
      const THREE = window.THREE;
      if (!scene || !THREE) return [];

      const set = new Set();
      const badType = (m)=> /Depth|Distance|Shadow|Sprite|Shader/.test(m?.type||'') ||
        m?.isLineBasicMaterial || m?.isLineDashedMaterial || m?.isPointsMaterial;
      const isOverlayObj = (o)=> o?.type==='Sprite' || o?.name?.startsWith?.('__LM_') || o?.userData?.__lmOverlay;

      scene.traverse((obj)=>{
        if (isOverlayObj(obj)) return;
        const mat = obj && obj.material;
        const push = (m)=>{
          if (!m || badType(m)) return;
          const n = (m.name||'').trim();
          if (!n || /^material\.[0-9]+$/.test(n)) return;
          set.add(n);
        };
        if (!mat) return;
        Array.isArray(mat) ? mat.forEach(push) : push(mat);
      });
      return Array.from(set);
    }catch(_){}
    return [];
  }

  function ensureMaterialSelect(){
    const sel =
      document.querySelector('[data-lm="material-select"]') ||
      document.querySelector('#lm-material-select') ||
      document.querySelector('select[name="material"]') ||
      document.querySelector('#material-select');
    if (sel) return sel;
    const box = document.querySelector('[data-lm="material-tab"], #lm-material-tab') || document.body;
    const wrap = document.createElement('div'); wrap.style.marginBottom='8px';
    const s = document.createElement('select'); s.id='lm-material-select'; s.style.width='100%';
    wrap.appendChild(s); box.prepend(wrap); return s;
  }

  function buildMaterialSelect(materials){
    const sel = ensureMaterialSelect();
    while (sel.firstChild) sel.removeChild(sel.firstChild);
    const add=(v,t)=>{ const o=document.createElement('option'); o.value=v; o.textContent=t; sel.appendChild(o); };
    add('', '— Select —');
    materials.forEach(m=>add(m,m));
    sel.addEventListener('change', ()=>{ st.currentMaterialKey = sel.value; }, { once:false });
    sel.dispatchEvent(new Event('change', {bubbles:true}));
  }

  async function populateWhenReady(){
    const retryMax=50, interval=200;
    for (let i=0;i<retryMax;i++){
      const mats = await listMaterialsRobust();
      if (mats && mats.length){
        buildMaterialSelect(mats);
        log('materials populated', mats.length);
        return;
      }
      await new Promise(r=>setTimeout(r, interval));
    }
    warn('[mat-orch-hotfix] materials still empty after retries (non-fatal)');
  }

  (function hideMaterialsSheetInPicker(){
    const HIDE = (opt)=>{
      const txt = (opt.textContent || opt.value || '').trim();
      if (!txt) return false;
      if (txt === '__LM_MATERIALS' || txt.startsWith('__LM_')) { opt.remove(); return true; }
      return false;
    };
    try{ document.querySelectorAll('select option').forEach(HIDE); }catch(_){}
    if (!hideMaterialsSheetInPicker._armed){
      hideMaterialsSheetInPicker._armed = true;
      let t=null;
      const mo = new MutationObserver(()=>{
        if (t) clearTimeout(t);
        t = setTimeout(()=>{ try{ document.querySelectorAll('select option').forEach(HIDE); }catch(_){} }, 60);
      });
      mo.observe(document.body, { childList:true, subtree:true });
    }
  })();

  populateWhenReady();
})();