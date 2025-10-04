
// ui.js — resilient UI bootstrap for LociMyu
// Exports setupUI(app). No DOM assumptions; all bindings are optional.
// Also provides a minimal overlay shim so calls won't crash even if
// the page hasn't added overlay elements yet.

function $(sel, scope=document){ try { return scope.querySelector(sel); } catch(e){ return null; } }
function $all(sel, scope=document){ try { return Array.from(scope.querySelectorAll(sel)); } catch(e){ return []; } }

function ensureOverlayHost(){
  // Try existing host
  let host = $('#lmy-overlay');
  if (host) return host;
  // Create minimal overlay host to avoid null errors
  host = document.createElement('div');
  host.id = 'lmy-overlay';
  host.style.cssText = [
    'position:fixed','left:24px','bottom:24px','max-width:520px',
    'z-index:1000','display:none','background:rgba(0,0,0,.75)',
    'color:#eee','padding:12px','border-radius:12px','backdrop-filter:blur(4px)',
    'box-shadow:0 6px 24px rgba(0,0,0,.35)'
  ].join(';');
  const title = document.createElement('div');
  title.id = 'lmy-overlay-title';
  title.style.cssText='font-size:12px;opacity:.8;margin-bottom:4px';
  const body = document.createElement('div');
  body.id = 'lmy-overlay-body';
  const close = document.createElement('button');
  close.textContent = '×';
  close.ariaLabel = 'Close';
  close.style.cssText='position:absolute;right:8px;top:6px;background:#0000;color:#fff;border:none;font-size:18px;cursor:pointer';
  close.addEventListener('click', ()=>{ host.style.display='none'; });
  host.appendChild(close);
  host.appendChild(title);
  host.appendChild(body);
  document.body.appendChild(host);
  return host;
}

function makeOverlayAPI(){
  const host = ensureOverlayHost();
  const setContent = (opt={}) => {
    const title = $('#lmy-overlay-title', host);
    const body = $('#lmy-overlay-body', host);
    if (title) title.textContent = opt.title ?? '';
    if (body) {
      body.innerHTML='';
      if (opt.imgUrl){
        const img = new Image();
        img.src = opt.imgUrl;
        img.style.cssText='max-width:100%;border-radius:8px;display:block';
        body.appendChild(img);
      }
      const p = document.createElement('div');
      p.textContent = opt.body ?? '';
      p.style.marginTop='8px';
      body.appendChild(p);
    }
  };
  return {
    showOverlay(opt={}){ setContent(opt); host.style.display='block'; },
    hideOverlay(){ host.style.display='none'; }
  };
}

export function setupUI(app){
  // Prevent crashes when elements are missing by guarding all bindings
  // Sign-in chip
  const signChip = $('#signin-chip');
  if (signChip){
    const renderAuth = () => {
      const ok = !!(app && app.auth && app.auth.isSignedIn && app.auth.isSignedIn());
      signChip.textContent = ok ? 'Signed in' : 'Sign in';
      signChip.classList.toggle('signed', !!ok);
    };
    signChip.addEventListener('click', async () => {
      try{
        if (!app?.auth) return;
        if (app.auth.isSignedIn() ) await app.auth.signOut();
        else await app.auth.signIn();
        renderAuth();
      }catch(e){ console.warn('[ui] sign toggle failed', e); }
    });
    renderAuth();
  }

  // Optional buttons (existence guarded)
  const btnGLB = $('#btn-load-glb');
  if (btnGLB){
    btnGLB.addEventListener('click', async ()=>{
      try{ await app?.uiHandlers?.onLoadGLB?.(); }catch(e){ console.warn('[ui] GLB load failed', e); }
    });
  }
  const btnRefresh = $('#btn-refresh-images') || $('#refresh-images');
  if (btnRefresh){
    btnRefresh.addEventListener('click', async ()=>{
      try{ await app?.uiHandlers?.onRefreshImages?.(); }catch(e){ console.warn('[ui] refresh images failed', e); }
    });
  }

  // White key controls (checkbox + range)
  const whiteChk = $('#whitekey-enabled');
  const whiteRange = $('#whitekey-range');
  const applyWhite = () => {
    try{
      const v = parseFloat(whiteRange?.value ?? '0');
      const on = !!whiteChk?.checked;
      if (app?.viewer?.setWhiteKeyEnabled) app.viewer.setWhiteKeyEnabled(on);
      if (app?.viewer?.setWhiteKeyThreshold) app.viewer.setWhiteKeyThreshold(v);
    }catch(e){ console.warn('[ui] whitekey apply failed', e); }
  };
  if (whiteChk) whiteChk.addEventListener('change', applyWhite);
  if (whiteRange) whiteRange.addEventListener('input', applyWhite);

  // HSL/Opacity sliders (guarded)
  const hue = $('#mat-hue'), sat = $('#mat-sat'), lig = $('#mat-light'), op = $('#mat-opacity');
  const applyHSL = () => {
    try{
      if (!app?.viewer) return;
      const h = parseFloat(hue?.value ?? '0');
      const s = parseFloat(sat?.value ?? '0');
      const l = parseFloat(lig?.value ?? '0');
      app.viewer.setHSL?.(h, s, l);
    }catch(e){ console.warn('[ui] hsl apply failed', e); }
  };
  const applyOpacity = () => {
    try{
      if (!app?.viewer) return;
      const o = parseFloat(op?.value ?? '1');
      app.viewer.setOpacity?.(o);
    }catch(e){ console.warn('[ui] opacity apply failed', e); }
  };
  if (hue) hue.addEventListener('input', applyHSL);
  if (sat) sat.addEventListener('input', applyHSL);
  if (lig) lig.addEventListener('input', applyHSL);
  if (op)  op.addEventListener('input', applyOpacity);

  // Minimal overlay shim (exposed both to app and window for backward compat)
  const overlay = makeOverlayAPI();
  app.ui = app.ui || {};
  app.ui.overlay = overlay;
  if (!window.__LMY_overlay) window.__LMY_overlay = overlay;

  // Hide old boot overlay if it exists
  const hideBoot = () => {
    const boot = $('#boot-overlay') || $('.boot-overlay');
    if (boot) boot.remove();
  };
  // If viewer dispatches ready event, hide boot; otherwise hide after 1s.
  window.addEventListener('lmy:viewer-ready', hideBoot, { once: true });
  setTimeout(hideBoot, 1000);

  // Fire ui-ready for any late listeners
  window.dispatchEvent(new CustomEvent('lmy:ui-ready'));
}
