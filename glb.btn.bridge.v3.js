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
      font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif}
    #${OVERLAY_ID}.on{opacity:1}
    #${OVERLAY_ID} .box{display:flex;flex-direction:column;align-items:center;gap:10px;
      padding:16px 18px;border-radius:14px;background:rgba(18,18,18,.75);color:#fff;
      box-shadow:0 4px 18px rgba(0,0,0,.3)}
    #${OVERLAY_ID} .spin{width:28px;height:28px;border-radius:50%;border:3px solid rgba(255,255,255,.35);
      border-top-color:#fff;animation:lmspin 1s linear infinite}
    @keyframes lmspin{to{transform:rotate(360deg)}}
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
        if (host === document.body) ov.style.position='fixed';
        host.appendChild(ov);
      }
      const txt = ov.querySelector('.txt'); if (txt) txt.textContent = msg;
      requestAnimationFrame(()=>ov.classList.add('on'));
    }catch(e){}
  }
  function hideOverlay(){
    try{
      const ov = document.getElementById(OVERLAY_ID);
      if (!ov) return;
      ov.classList.remove('on');
      setTimeout(()=>ov.remove(), 180);
    }catch(e){}
  }
  window.addEventListener('lm:model-ready', hideOverlay);
  window.addEventListener('lm:scene-ready', ()=>setTimeout(hideOverlay, 100));

  /* --- Helpers --- */
  function extractId(input){
    if (!input) return '';
    if (/^[a-zA-Z0-9_-]{10,}$/.test(input)) return input;
    try{
      const u = new URL(input);
      const m = u.pathname.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
      if (m) return m[1];
      const qp = u.searchParams.get('id');
      if (qp) return qp;
    }catch(_){}
    return '';
  }
  function ensureCanvas(){
    let canvas = document.querySelector("#viewer-canvas") || document.querySelector("canvas");
    if (canvas) return canvas;
    let container = document.querySelector("#viewer") || document.querySelector("#three-container") || document.querySelector(".viewer") || document.body;
    canvas = document.createElement("canvas");
    canvas.id = "viewer-canvas";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.display = "block";
    if (container === document.body){
      const wrapper = document.createElement("div");
      wrapper.id = "viewer-wrapper";
      wrapper.style.position = "relative";
      wrapper.style.width = "100%";
      wrapper.style.height = "70vh";
      wrapper.style.margin = "8px 0";
      wrapper.appendChild(canvas);
      document.body.prepend(wrapper);
    } else {
      container.prepend(canvas);
    }
    return canvas;
  }
  async function getToken(){
    if (typeof window.__lm_getAccessToken === 'function'){
      return await window.__lm_getAccessToken();
    }
    try{ const g = await import('./gauth.module.js'); if (g.getAccessToken) return await g.getAccessToken(); }catch(_){}
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
      try{ if (typeof mod[name]==='function'){ log('calling', name); await mod[name](); break; } }
      catch(e){ err(name+' failed', e); }
    }
    await new Promise(res=>{
      let done=false; const ok=()=>{ if(done) return; done=true; res(true); };
      setTimeout(()=>{ if(!done) res(!!document.querySelector('canvas')); }, 3000);
      window.addEventListener('lm:scene-ready', ok, { once:true });
      window.addEventListener('lm:model-ready', ok, { once:true });
      if (document.querySelector('canvas')) setTimeout(ok, 50);
    });
    return true;
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
    log('button wired v3');
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
  } else { wireBtn(); wireEvent(); }
})();