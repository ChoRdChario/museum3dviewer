/* LociMyu Material Orchestrator
   VERSION_TAG: V6_12i_ENUM_ON_TAB
   - Populate material dropdown when the Material tab becomes ACTIVE
   - Enumerate via viewerBridge.listMaterials() (preferred) or scene traversal fallback
   - Hide __LM_* sheets from caption sheet pickers
   - Safe, idempotent; minimal logging
*/
(function(){
  const NS='[mat-orch]';
  const log =(…a)=>{ try{ console.log(NS, …a); }catch(_){}};
  const warn=(…a)=>{ try{ console.warn(NS, …a); }catch(_){}};
  log('loaded VERSION_TAG:V6_12i_ENUM_ON_TAB');

  // ---------- State ----------------------------------------------------------
  const st = (window.__lm_materialState = window.__lm_materialState || {
    populatedOnce:false,
    lastPopulateAt:0
  });

  // ---------- Utilities ------------------------------------------------------
  const sleep = (ms)=> new Promise(r=>setTimeout(r, ms));

  function getSelect(){
    return document.querySelector('[data-lm="material-select"]')
        || document.querySelector('#lm-material-select')
        || document.querySelector('select[name="material"]')
        || document.querySelector('#material-select')
        || null;
  }
  function ensureSelect(){
    let sel = getSelect();
    if (sel) return sel;
    // Mount under Material tab container if possible
    const box = document.querySelector('[data-lm="material-tab"]')
            || document.querySelector('#lm-material-tab')
            || document.querySelector('[data-lm="right-panel"]')
            || document.querySelector('#right-panel')
            || document.body;
    const wrap = document.createElement('div');
    wrap.style.cssText='margin:6px 0;';
    const lab = document.createElement('div');
    lab.textContent='Select material';
    lab.style.cssText='font-size:12px;opacity:.7;margin-bottom:4px;';
    sel = document.createElement('select');
    sel.id = 'lm-material-select';
    sel.style.width='100%';
    wrap.appendChild(lab);
    wrap.appendChild(sel);
    box.prepend(wrap);
    return sel;
  }
  function fillSelect(values){
    const sel = ensureSelect();
    while (sel.firstChild) sel.removeChild(sel.firstChild);
    const add=(v,t)=>{ const o=document.createElement('option'); o.value=v; o.textContent=t; sel.appendChild(o); };
    add('', '— Select —');
    values.forEach(v=>add(v,v));
    sel.dispatchEvent(new Event('change', {bubbles:true}));
    log('materials populated', values.length);
  }

  // ---------- Enumeration ----------------------------------------------------
  function listFromBridge(){
    try{
      const b = window.viewerBridge || window.__lm_viewerBridge || window.lm_viewer_bridge;
      if (b && typeof b.listMaterials === 'function'){
        const arr = b.listMaterials() || [];
        return Array.isArray(arr) ? arr.slice() : [];
      }
    }catch(_){}
    return [];
  }
  function listFromScene(){
    // Prefer scene via bridge if available
    const scene = (window.viewerBridge && window.viewerBridge.getScene && window.viewerBridge.getScene())
               || (window.__lm_getScene && window.__lm_getScene())
               || (window.__lm_viewer && window.__lm_viewer.scene)
               || (window.viewer && window.viewer.scene)
               || null;
    const THREE = window.THREE;
    if (!scene || !THREE) return [];
    // filter out overlays / non-surface materials
    const badType = (m)=> /Depth|Distance|Shadow|Sprite|Shader/.test(m?.type||'')
                      || m?.isLineBasicMaterial || m?.isLineDashedMaterial || m?.isPointsMaterial;
    const isOverlayObj = (o)=> o?.type==='Sprite' || o?.name?.indexOf?.('__LM_')===0 || o?.userData?.__lmOverlay;
    const set = new Set();
    scene.traverse((obj)=>{
      if (isOverlayObj(obj)) return;
      const push=(m)=>{
        if (!m || badType(m)) return;
        const n=(m.name||'').trim();
        if (!n || /^material\.\d+$/.test(n)) return;
        set.add(n);
      };
      const mat=obj.material;
      if (!mat) return;
      if (Array.isArray(mat)) mat.forEach(push); else push(mat);
    });
    return Array.from(set);
  }

  async function populateOnceWithBackoff(maxWaitMs){
    const deadline = Date.now()+maxWaitMs;
    let tryBridgeFirst = true;
    while (Date.now() < deadline){
      let list = tryBridgeFirst ? listFromBridge() : [];
      if (!list.length) list = listFromScene();
      if (list.length){
        fillSelect(list);
        st.populatedOnce = true;
        st.lastPopulateAt = Date.now();
        return true;
      }
      // alternate between bridge/scene every tick
      tryBridgeFirst = !tryBridgeFirst;
      await sleep(200);
    }
    warn('[mat-orch-hotfix] materials still empty after retries (non-fatal)');
    return false;
  }

  // ---------- Tab activation detection --------------------------------------
  function isMaterialTabActive(){
    // heuristics: active nav/tab with text 'Material', or panel has aria-selected=true / visible
    const activeBtn = Array.from(document.querySelectorAll('button, [role="tab"]'))
      .find(el=>/material/i.test(el.textContent||'') && (el.getAttribute('aria-selected')==='true' || el.classList.contains('active')));
    if (activeBtn) return true;
    const panel = document.querySelector('#lm-material-tab,[data-lm="material-tab"]');
    if (panel){
      const style = window.getComputedStyle(panel);
      if (style && style.display!=='none' && style.visibility!=='hidden') return true;
      if (panel.getAttribute('aria-hidden')==='false') return true;
    }
    // fallback: if only one tab UI exists, assume active after 1s
    return false;
  }

  async function maybePopulateOnActivation(){
    // called on tab clicks / mutations
    if (st.populatedOnce) return;
    if (!isMaterialTabActive()) return;
    await populateOnceWithBackoff(12000);
  }

  function armTabWatchers(){
    // click handlers on any nav that contains "Material"
    document.addEventListener('click', (e)=>{
      const t = e.target;
      if (!t) return;
      const label = (t.textContent||'') + ' ' + ((t.closest && t.closest('button,[role="tab"]')||{})?.textContent||'');
      if (/material/i.test(label)) setTimeout(maybePopulateOnActivation, 10);
    }, true);
    // mutation observer to catch programmatic tab switches
    const mo = new MutationObserver(()=>{
      if (isMaterialTabActive()) maybePopulateOnActivation();
    });
    mo.observe(document.body, { attributes:true, childList:true, subtree:true });
    // safety: also try once on load (with backoff, but only when tab already active)
    setTimeout(maybePopulateOnActivation, 300);
  }

  // ---------- Hide __LM_* from sheet pickers ---------------------------------
  function hideMaterialsSheetInPicker(){
    const HIDE = (opt) => {
      const txt = (opt.textContent || opt.value || '').trim();
      if (!txt) return false;
      if (txt === '__LM_MATERIALS' || txt.indexOf('__LM_')===0) { opt.remove(); return true; }
      return false;
    };
    try{ document.querySelectorAll('select option').forEach(HIDE); }catch(_){}
    if (!hideMaterialsSheetInPicker._armed){
      hideMaterialsSheetInPicker._armed = true;
      let t=null;
      const mo = new MutationObserver(()=>{
        if (t) clearTimeout(t);
        t = setTimeout(()=>{
          try{ document.querySelectorAll('select option').forEach(HIDE); }catch(_){}
        }, 60);
      });
      mo.observe(document.body, { childList:true, subtree:true });
    }
  }

  // ---------- Boot -----------------------------------------------------------
  hideMaterialsSheetInPicker();
  armTabWatchers();
})();