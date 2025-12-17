
/* glb.btn.bridge.v3.js — v3.4 (loader + save sheet ensure + gid-first ctx)
 * viewer.module.cdn.js の export から __lm_viewer_bridge を組み立てる（案1ベース）
 */
(function(){
  const TAG='[glb-bridge-v3]';
  const log=(...a)=>console.log(TAG, ...a);
  const err=(...a)=>console.error(TAG, ...a);

  /* --- Loading overlay --- */
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
    return document.querySelector('#viewer-wrapper')
        || document.querySelector('#viewer')
        || document.querySelector('#three-container')
        || document.querySelector('.viewer')
        || document.body;
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

  /**
   * 既存のビューア用 canvas を最優先で再利用する。
   * どうしても見つからない場合のみ、新しい canvas を控えめに追加する。
   * レイアウトを壊さないよう wrapper は新規作成しない。
   */
  function ensureCanvas(){
    // 1) 既知のコンテナ内を優先
    let canvas = document.querySelector(
      '#viewer-wrapper canvas, ' +
      '#viewer canvas, ' +
      '.viewer canvas, ' +
      'canvas.lm-viewer, ' +
      '#lm-viewer-canvas, ' +
      'canvas#viewer'
    );
    if (canvas) return canvas;

    // 2) ドキュメント内の既存 canvas を使う（最初に見つかったもの）
    canvas = document.querySelector('main canvas, body > canvas, canvas');
    if (canvas) return canvas;

    // 3) どうしても無ければ、新しい canvas を控えめに追加
    const host =
      document.querySelector('#viewer-wrapper')
      || document.querySelector('#viewer')
      || document.querySelector('.viewer')
      || document.body;

    canvas = document.createElement('canvas');
    canvas.className = 'lm-viewer';
    canvas.id = 'lm-viewer-canvas';

    // layout を壊さないよう、単に末尾に append するだけに留める
    host.appendChild(canvas);

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

  // Ensure viewer.module is available.
  // Prefer existing globals, otherwise lazy-load viewer.module.cdn.js.
  // This avoids relying on polling-based autobind ordering.
  async function ensureViewerModule(){
    if (window.__lm_viewer_module) return window.__lm_viewer_module;
    try{
      const mod = await import('./viewer.module.cdn.js');
      window.__lm_viewer_module = mod;
      try{ ensureViewerBridge(mod); }catch(_e){}
      return mod;
    }catch(e){
      err('failed to import viewer.module.cdn.js', e);
      return null;
    }
  }

  async function ensureViewerReady(mod){
    try{
      if (typeof mod.ensureViewer === 'function'){
        const canvas = ensureCanvas();
        log('calling ensureViewer with canvas', canvas.id||'(anon)');
        await mod.ensureViewer({ canvas, container: canvas.parentElement||document.body });
        return;
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
      const existing = window.__lm_viewer_bridge;
      const hasCore = existing && typeof existing.addPinMarker === 'function' && typeof existing.clearPins === 'function';
      const bridge = hasCore ? existing : {};

      const keys = [
        'ensureViewer','loadGlbFromDrive','listMaterials','getScene',
        'onCanvasShiftPick','onPinSelect','addPinMarker','clearPins',
        'removePinMarker','setPinSelected','setPinColorFilter','getPinColorFilter','pulsePin','onRenderTick','projectPoint',
        'resetAllMaterials','resetMaterial','setCurrentGlbId','applyMaterialProps',
        'getCameraState','setCameraState','setProjection','setBackgroundColor','getBackgroundColor','getModelBounds'
      ];

      keys.forEach((k) => {
        if (mod && typeof mod[k] === 'function' && !bridge[k]) {
          bridge[k] = mod[k];
        }
      });

      if (!hasCore){
        window.__lm_viewer_bridge = bridge;
        const vb = window.viewerBridge = window.viewerBridge || {};
        keys.forEach((k) => {
          if (typeof bridge[k] === 'function' && !vb[k]) vb[k] = bridge[k];
        });
        log('viewer bridge established from viewer.module.cdn.js exports');
      } else {
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
      const rawCaptionGid = res && res.defaultCaptionGid;
      const sheetGid = (rawCaptionGid === undefined || rawCaptionGid === null || rawCaptionGid === '') ? '' : String(rawCaptionGid);

      if (spreadsheetId){
        window.__LM_ACTIVE_SPREADSHEET_ID = spreadsheetId;
        if (sheetGid) window.__LM_ACTIVE_SHEET_GID = sheetGid;
        window.dispatchEvent(new CustomEvent('lm:sheet-context', { detail:{ spreadsheetId, sheetGid } }));
                try{
          const mat = await import('./materials.sheet.persist.js');
          const fn =
            (mat && mat.ensureMaterialsHeader) ||
            (window.materialsPersist && window.materialsPersist.ensureMaterialsHeader) ||
            window.__lm_ensureMaterialsHeader;
          if (typeof fn === 'function') await fn(spreadsheetId);
        }catch(e){ err('ensureMaterialsHeader failed', e); }
      }
      return res;
    }catch(e){ err('postLoadEnsureSaveSheet failed', e); }
  }

  async function loadById(fileId){
    // Gate the UI until sheet/captions/images have settled.
    const gate = window.__LM_READY_GATE__;
    let gateRun = 0;
    try{
      if (gate && typeof gate.begin === 'function'){
        gateRun = gate.begin(['glb','sheet','captions','images'], { message:'Loading…', timeoutMs: 20000 });
      }
    }catch(_e){ gateRun = 0; }

    showOverlay('GLB を読み込んでいます…');
    let safe = true; const safeHide=()=>{ if(safe){ safe=false; hideOverlay(); } };

    try{
      const mod = await ensureViewerModule();
      if (!mod) throw new Error('viewer.module missing');

      await ensureViewerReady(mod);

      const token = await getToken();
      await mod.loadGlbFromDrive(fileId, { token });

      // Track GLB id for downstream modules (they may rely on this).
      try{ window.__LM_CURRENT_GLB_ID__ = fileId; }catch(_e){}
      try{ gate?.mark?.('glb'); }catch(_e){}

      // Existing pipeline: locate / create save sheet and dispatch sheet-context, etc.
      await postLoadEnsureSaveSheet(fileId);

      // Images are loaded from GLB folder (Drive). Let the images loader start now.
      try{ document.dispatchEvent(new Event('lm:refresh-images')); }catch(_e){}
    }catch(e){
      err('loadById failed', e);
      try{ gate?.finish?.(); }catch(_e){}
      safeHide();
      throw e;
    }

    if (gateRun){
      try{ await gate.wait(); }catch(_e){}
      safeHide();
    } else {
      setTimeout(safeHide, 120);
    }
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
        try{ window.__LM_ACTIVE_GLB_ID = id; }catch(_){}
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
        try{ window.__LM_ACTIVE_GLB_ID = id; }catch(_){}
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