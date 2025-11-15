/* glb.btn.bridge.v3.js — v3.4 (loader + save sheet ensure + drive images bridge)
 * viewer.module.cdn.js の export から __lm_viewer_bridge を組み立てる
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
        ov.innerHTML = `
          <div class="box">
            <div class="spin"></div>
            <div class="txt"></div>
          </div>
        `;
        host.appendChild(ov);
      }
      const txt = ov.querySelector('.txt');
      if (txt) txt.textContent = msg;
      ov.classList.add('on');
    }catch(e){
      err('showOverlay failed', e);
    }
  }
  function hideOverlay(){
    try{
      const ov = document.getElementById(OVERLAY_ID);
      if (ov) ov.classList.remove('on');
    }catch(e){
      err('hideOverlay failed', e);
    }
  }

  /* --- Drive URL helper --- */
  function extractId(raw){
    if (!raw) return '';
    raw = String(raw).trim();
    // 1) すでに「IDっぽい」ならそのまま採用
    if (/^[a-zA-Z0-9_-]{10,}$/.test(raw)) return raw;
    // 2) URL パターンを試す
    try{
      const u = new URL(raw);
      // /file/d/<id>/...
      let m = u.pathname.match(/\/file\/d\/([a-zA-Z0-9_-]{20,})/);
      if (m) return m[1];
      // ?id=<id>
      const qp = u.searchParams.get('id');
      if (qp && /^[a-zA-Z0-9_-]{10,}$/.test(qp)) return qp;
    }catch(_){}
    // 3) 最後の手段: 文字列中の「長めの Drive っぽいトークン」
    const m2 = raw.match(/[-\w]{20,}/);
    return m2 ? m2[0] : '';
  }

  /* --- Auth helper --- */
  async function getToken(){
    try{
      if (window.__LM_auth && typeof window.__LM_auth.getAccessToken === 'function'){
        return await window.__LM_auth.getAccessToken();
      }
    }catch(e){
      err('getToken via __LM_auth failed', e);
    }
    if (typeof window.getAccessToken === 'function'){
      return await window.getAccessToken();
    }
    throw new Error('No access token provider found');
  }

  /* --- Viewer bridge assembly --- */
  function ensureViewerBridge(mod){
    try{
      if (window.__lm_viewer_bridge) return;
      if (!mod) return;
      const {
        addPinMarker,
        clearPins,
        removePinMarker,
        resetMaterial,
        resetAllMaterials,
        listMaterials,
        applyMaterialProps,
        projectPoint,
        onCanvasShiftPick,
        onPinSelect,
        onRenderTick,
        getScene,
        ensureViewer,
        setCurrentGlbId,
        loadGlbFromDrive,
      } = mod;

      const bridge = {
        addPinMarker,
        clearPins,
        removePinMarker,
        resetMaterial,
        resetAllMaterials,
        listMaterials,
        applyMaterialProps,
        projectPoint,
        onCanvasShiftPick,
        onPinSelect,
        onRenderTick,
        getScene,
        ensureViewer,
        setCurrentGlbId,
        loadGlbFromDrive,
      };

      window.__lm_viewer_bridge = bridge;
      try{
        document.dispatchEvent(new Event('lm:viewer-bridge-ready'));
      }catch(e){
        err('viewer-bridge-ready dispatch failed', e);
      }
      log('viewer bridge established from viewer.module.cdn.js exports');
    }catch(e){
      err('ensureViewerBridge failed', e);
    }
  }

  async function ensureViewerReady(mod){
    if (!mod || typeof mod.ensureViewer !== 'function'){
      throw new Error('viewer module ensureViewer missing');
    }
    const canvas = ensureCanvas();
    await mod.ensureViewer(canvas);
  }

  /**
   * ビューア用 canvas の確保。
   * すでに存在する canvas を優先し、無ければ最後に控えめに追加する。
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

    host.appendChild(canvas);
    return canvas;
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
          if (mat.ensureMaterialsHeader) await mat.ensureMaterialsHeader(spreadsheetId);
        }catch(e){ err('ensureMaterialsHeader failed', e); }
      }
      return res;
    }catch(e){ err('postLoadEnsureSaveSheet failed', e); }
  }

  let __LM_CURRENT_GLB_ID = null;

  async function ensureDriveBridge(fileId){
    try{
      __LM_CURRENT_GLB_ID = fileId || null;
      const mod = await import('./drive.images.list.js');
      if (!mod || typeof mod.listSiblingImagesByGlbId !== 'function'){
        log('drive.images.list.js missing or invalid');
        return;
      }
      const bridge = {
        listSiblingImages: async () => {
          try{
            if (!__LM_CURRENT_GLB_ID) return [];
            return await mod.listSiblingImagesByGlbId(__LM_CURRENT_GLB_ID);
          }catch(e){
            err('listSiblingImages failed', e);
            return [];
          }
        }
      };
      window.__lm_drive_bridge = bridge;
      try{
        document.dispatchEvent(new CustomEvent('lm:drive-bridge-ready'));
      }catch(e){
        err('lm:drive-bridge-ready dispatch failed', e);
      }
      log('drive bridge ready for', __LM_CURRENT_GLB_ID);
    }catch(e){
      err('ensureDriveBridge failed', e);
    }
  }

  async function loadById(fileId){
    if (!fileId){
      err('loadById called with empty fileId');
      return;
    }
    const mod = await import('./viewer.module.cdn.js');
    try{ console.log(TAG, 'exports:', Object.keys(mod)); }catch(_){}
    ensureViewerBridge(mod);
    showOverlay('GLB を読み込んでいます…');
    let safe = true; const safeHide=()=>{ if(safe){ safe=false; hideOverlay(); } };
    try{
      await ensureViewerReady(mod);
      const token = await getToken();
      await mod.loadGlbFromDrive(fileId, { token });
    }catch(e){
      err('loadGlbFromDrive threw', e);
      safeHide();
      throw e;
    }
    setTimeout(safeHide, 120);
    await postLoadEnsureSaveSheet(fileId);
    await ensureDriveBridge(fileId);
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
        if (!id){
          log('no id', raw);
          return;
        }
        log('load fileId', id);
        await loadById(id);
      }catch(e){ err('btn load failed', e); }
    }, { passive:true });
    log('button wired');
  }

  function wireEvent(){
    window.addEventListener('lm:load-glb', async (ev)=>{
      try{
        const src = ev && ev.detail && (ev.detail.id || ev.detail.url);
        if (!src) return;
        const id = extractId(src);
        if (!id){
          log('event no id', src);
          return;
        }
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
