/* glb.btn.bridge.v3.js — v3.2 (loader + save sheet ensure + gid-first ctx) */
(function(){
  const TAG='[glb-bridge-v3]';
  const log=(...a)=>console.log(TAG, ...a);
  const err=(...a)=>console.error(TAG, ...a);

  /* --- Loading overlay (same as v3.1) --- */
  const OVERLAY_ID = 'lm-glb-loading-overlay';
  function ensureStyle() {
    if (document.getElementById(OVERLAY_ID+'-style')) return;
    const css = document.createElement('style');
    css.id = OVERLAY_ID+'-style';
    css.textContent = `
    #${OVERLAY_ID}{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
      background:rgba(0,0,0,.35);backdrop-filter:blur(1px);
      z-index:9999;pointer-events:none;opacity:0;transition:opacity .15s ease;
    }
    #${OVERLAY_ID}.on{pointer-events:auto;opacity:1;}
    #${OVERLAY_ID} .box{min-width:240px;padding:16px 20px;border-radius:8px;
      background:rgba(0,0,0,.8);color:#fff;display:flex;align-items:center;gap:12px;
      box-shadow:0 4px 16px rgba(0,0,0,.6);font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
    }
    #${OVERLAY_ID} .spin{width:20px;height:20px;border-radius:999px;border:3px solid rgba(255,255,255,.3);
      border-top-color:#fff;animation:lm-glb-spin 0.9s linear infinite;}
    #${OVERLAY_ID} .txt{font-size:14px;white-space:nowrap;}
    @keyframes lm-glb-spin{to{transform:rotate(360deg);}}
    `;
    document.head.appendChild(css);
  }
  function findViewerHost(){
    return document.querySelector('#viewer-wrapper')||document.querySelector('#viewer')
        || document.querySelector('#three-container')||document.querySelector('.viewer')||document.body;
  }
  function showOverlay(msg='読み込み中…'){
    try{
      ensureStyle();
      const host = findViewerHost();
      let ov = document.getElementById(OVERLAY_ID);
      if (!ov){
        ov = document.createElement('div');
        ov.id = OVERLAY_ID;
        ov.setAttribute('aria-live','polite');
        ov.innerHTML = `<div class="box"><div class="spin"></div><div class="txt"></div></div>`;
        if (host === document.body)
          host.appendChild(ov);
        else {
          const style = getComputedStyle(host);
          if (style.position === 'static') host.style.position = 'relative';
          host.appendChild(ov);
        }
      }
      const txt = ov.querySelector('.txt');
      if (txt) txt.textContent = msg;
      ov.classList.add('on');
    }catch(e){ err('showOverlay failed', e); }
  }
  function hideOverlay(){
    try{
      const ov = document.getElementById(OVERLAY_ID);
      if (ov) ov.classList.remove('on');
    }catch(e){ err('hideOverlay failed', e); }
  }

  /* --- GLB id extraction helpers --- */
  function extractId(raw){
    if (!raw) return '';
    raw = String(raw).trim();
    if (!raw) return '';
    if (/^[a-zA-Z0-9_-]{20,}$/.test(raw)) return raw;
    const m = raw.match(/[?&#/]id=([a-zA-Z0-9_-]+)/) || raw.match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (m && m[1]) return m[1];
    const m2 = raw.match(/[-\w]{25,}/);
    return (m2 && m2[0]) || '';
  }

  function ensureCanvas(){
    let canvas = document.querySelector('canvas.lm-viewer, #lm-viewer-canvas, canvas#viewer');
    if (canvas) return canvas;
    const container = findViewerHost();
    canvas = document.createElement('canvas');
    canvas.className = 'lm-viewer';
    canvas.id = 'lm-viewer-canvas';
    const wrapper = document.createElement('div');
    wrapper.id = 'viewer-wrapper';
    wrapper.style.position = 'relative';
    wrapper.style.width = '100%';
    wrapper.style.height = '70vh';
    wrapper.style.margin = '8px 0';
    wrapper.appendChild(canvas);
    if (container === document.body){
      document.body.prepend(wrapper);
    }else{
      container.prepend(wrapper);
    }
    return canvas;
  }

  async function getToken(){
    if (typeof window.__lm_getAccessToken === 'function'){
      return await window.__lm_getAccessToken();
    }
    try{
      const g = await import('./gauth.module.js');
      if (g.getAccessToken) return await g.getAccessToken();
    }catch(_){}
    throw new Error('no token provider');
  }

  async function ensureViewerReady(mod){
    try{
      if (typeof mod.ensureViewer === 'function'){
        const canvas = ensureCanvas();
        log('calling ensureViewer with canvas', canvas.id||'(anon)');
        await mod.ensureViewer({ canvas, container: canvas.parentElement||document.body });
      }
    }catch(e){ err('ensureViewer(opts) failed', e); }
    const cands=['bootViewer','initViewer','setupViewer','mountViewer','createViewer','startViewer','init'];
    for (const name of cands){
      try{
        if (typeof mod[name]==='function'){
          log('calling', name);
          await mod[name]();
          break;
        }
      }catch(e){ err(name+' failed', e); }
    }
  }

  // viewer.module.cdn.js の export から __lm_viewer_bridge を組み立てる
  function ensureViewerBridge(mod){
    try{
      // 既存ブリッジが core API を持っていればそれを優先的に拡張
      const existing = window.__lm_viewer_bridge;
      const hasCore = existing && typeof existing.addPinMarker === 'function' && typeof existing.clearPins === 'function';
      const bridge = hasCore ? existing : {};

      const keys = [
        'ensureViewer','loadGlbFromDrive','listMaterials','getScene',
        'onCanvasShiftPick','onPinSelect','addPinMarker','clearPins',
        'removePinMarker','setPinSelected','onRenderTick','projectPoint',
        'resetAllMaterials','resetMaterial','setCurrentGlbId','applyMaterialProps'
      ];

      keys.forEach((k) => {
        if (mod && typeof mod[k] === 'function' && !bridge[k]) {
          bridge[k] = mod[k];
        }
      });

      if (!hasCore){
        window.__lm_viewer_bridge = bridge;
        // 後方互換: window.viewerBridge も同じ関数群を alias として持たせる
        const vb = window.viewerBridge = window.viewerBridge || {};
        keys.forEach((k) => {
          if (typeof bridge[k] === 'function' && !vb[k]) vb[k] = bridge[k];
        });
        log('viewer bridge established from viewer.module.cdn.js exports');
      } else {
        // 既存ブリッジがある場合は viewerBridge だけ追従させる
        const vb = window.viewerBridge;
        if (vb){
          keys.forEach((k) => {
            if (typeof bridge[k] === 'function' && !vb[k]) vb[k] = bridge[k];
          });
        }
        log('viewer bridge extended from viewer.module.cdn.js exports');
      }

      try{
        document.dispatchEvent(new Event('lm:viewer-bridge-ready'));
      }catch(e){
        err('viewer-bridge-ready dispatch failed', e);
      }
    }catch(e){
      err('ensureViewerBridge failed', e);
    }
  }

  async function postLoadEnsureSaveSheet(fileId){
    try{
      const loc = await import('./save.locator.js');
      const res = await loc.findOrCreateSaveSheetByGlbId(fileId);
      const spreadsheetId = res && res.spreadsheetId;
      const sheetGid = res && res.defaultCaptionGid || '';
      if (spreadsheetId){
        window.__LM_ACTIVE_SPREADSHEET_ID = spreadsheetId;
        if (sheetGid) window.__LM_ACTIVE_SHEET_GID = sheetGid;
        window.dispatchEvent(new CustomEvent('lm:sheet-context', { detail:{ spreadsheetId, sheetGid } }));
        try{
          const mat = await import('./materials.sheet.persist.js');
          if (mat.ensureMaterialsHeader) await mat.ensureMaterialsHeader(spreadsheetId);
        }catch(e){ err('ensureMaterialsHeader failed', e); }
      }
      return res;
    }catch(e){ err('postLoadEnsureSaveSheet failed', e); }
  }

  async function loadById(fileId){
    const mod = await import('./viewer.module.cdn.js');
    try{ console.log(TAG, 'exports:', Object.keys(mod)); }catch(_){}
    // viewer.module.cdn.js の export から viewer bridge を確立
    ensureViewerBridge(mod);
    showOverlay('GLB を読み込んでいます…');
    let safe = true; const safeHide=()=>{ if(safe){ safe=false; hideOverlay(); } };
    try{
      await ensureViewerReady(mod);
      const token = await getToken();
      await mod.loadGlbFromDrive(fileId, { token });
    }catch(e){ err('loadGlbFromDrive threw', e); safeHide(); throw e; }
    setTimeout(safeHide, 120);
    await postLoadEnsureSaveSheet(fileId);
  }

  function wireBtn(){
    const btn = document.querySelector('#btnGlb');
    if (!btn) return;
    if (btn.dataset && btn.dataset.glbBridgeWiredV3) return;
    btn.dataset.glbBridgeWiredV3 = '1';
    btn.addEventListener('click', async ()=>{
      try{
        const input = document.querySelector('#glbUrl');
        let raw = input && input.value ? input.value.trim() : '';
        if (!raw) raw = prompt('Driveの共有URL または fileId を入力してください') || '';
        const id = extractId(raw);
        if (!id){ log('no id'); return; }
        log('load fileId', id);
        await loadById(id);
      }catch(e){ err('btn load failed', e); }
    }, { passive:true });
    log('button wired');
  }

  function wireEvent(){
    window.addEventListener('lm:load-glb', async (ev)=>{
      try{
        const id = ev && ev.detail && ev.detail.id;
        if (!id) return;
        log('event load fileId', id);
        await loadById(id);
      }catch(e){ err('event load failed', e); }
    });
    log('event listener armed');
  }

  window.__LM_LOAD_GLB_BY_ID = loadById;

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', ()=>{ wireBtn(); wireEvent(); }, { once:true });
  } else {
    wireBtn();
    wireEvent();
  }
})();
