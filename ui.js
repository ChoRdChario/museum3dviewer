// ui.js — robust wiring & verbose logs (2025-10-05 unified)
console.log('[ui] module loaded');

function getEl(idA, idB){ return document.getElementById(idA) || (idB?document.getElementById(idB):null); }
function parseMatIndex(sel){
  if (!sel) return null;
  const v = sel.value || "";
  if (v === "(All)" || v === "") return null;
  const num = parseInt(String(v).split(":")[0], 10);
  return Number.isFinite(num) ? num : null;
}
function bindRange(el, handler){
  if (!el) return;
  const fn = ()=>{ try{ handler(parseFloat(el.value)); }catch(e){ console.warn('[ui] bindRange handler error', e); } };
  el.addEventListener('input', fn);
  el.addEventListener('change', fn);
}
async function driveApiDownload(id){
  const mod = await import('./utils_drive_api.js');
  if (!mod?.fetchDriveFileAsArrayBuffer) throw new Error('Drive helper missing');
  return await mod.fetchDriveFileAsArrayBuffer(id);
}
async function ensureViewerReady(){
  try{ await import('./viewer_ready.js'); }catch(_){}
  if (window.app?.viewer) return window.app.viewer;
  if (window.__viewerReadyPromise) return await window.__viewerReadyPromise;
  await new Promise(r=> setTimeout(r, 0));
  return window.app?.viewer;
}
async function ensureViewerShim(){
  try{ await import('./viewer_api_shim.js'); }catch(_){}
}
async function loadGLBWithViewer(buf){
  const viewer = await ensureViewerReady();
  await ensureViewerShim();
  if (viewer && typeof viewer.loadGLB === 'function'){
    console.log('[ui] using app.viewer.loadGLB');
    return await viewer.loadGLB(buf);
  }
  console.warn('[ui] app.viewer missing or loadGLB absent; trying fallback');
  try{
    const mod = await import('./viewer_min_loader.js');
    const v = await mod.loadGLBArrayBufferIntoStage(buf);
    console.log('[ui] fallback viewer rendered');
    return v;
  }catch(e){
    console.error('[ui] fallback viewer failed', e);
    throw e;
  }
}
async function normalizeId(raw){
  let id = (raw||"").trim();
  if (!id) throw new Error("empty file id/url");
  const m = id.match(/\/d\/([a-zA-Z0-9_-]{10,})/);
  if (m) id = m[1];
  return id;
}
export async function loadGLBFromDriveIdPublic(raw){
  console.log('[ui] loadGLBFromDriveIdPublic called');
  const id = await normalizeId(raw);
  let buf;
  try{
    buf = await driveApiDownload(id);        // 1) Auth path
    console.log('[ui] Drive API download ok', id, 'size=', buf.byteLength);
  }catch(e){
    console.warn('[ui] Drive API download failed:', e);
    try{
      const res = await fetch(`https://drive.google.com/uc?export=download&id=${encodeURIComponent(id)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      buf = await res.arrayBuffer();
      console.log('[ui] public uc download ok', id, 'size=', buf.byteLength);
    }catch(err){
      console.error('[ui] failed to download', err);
      const toast = getEl('toast');
      if (toast){
        toast.textContent = 'Failed to download GLB. Sign in for Drive access, or make the file public.';
        toast.style.display = 'block';
        setTimeout(()=> toast.style.display='none', 4000);
      }
      return;
    }
  }
  // expose buffer for debugging
  window.__lmy_lastGLB = buf;
  try{
    await loadGLBWithViewer(buf);            // 2) Show
    console.log('[ui] model handed to viewer/fallback');
    const toast = getEl('toast');
    if (toast){
      toast.textContent = 'Model loaded';
      toast.style.display = 'block';
      setTimeout(()=> toast.style.display='none', 1500);
    }
  }catch(e){
    console.error('[ui] failed to show model', e);
    const toast = getEl('toast');
    if (toast){
      toast.textContent = 'Failed to show model. See console for details.';
      toast.style.display = 'block';
      setTimeout(()=> toast.style.display='none', 4000);
    }
  }
}

// --- UI wiring ---
export function setupUI(app){
  console.log('[ui] setupUI start');
  const inp = getEl('fileIdInput','inpDriveId');
  const btn = getEl('btnLoad','btnLoadGLB');
  const demo= getEl('btnDemo','btnLoadDemo');

  if (btn){
    btn.addEventListener('click', ()=>{
      console.log('[ui] btnLoad clicked');
      loadGLBFromDriveIdPublic(inp?.value||"");
    });
  } else {
    console.warn('[ui] btnLoad/btnLoadGLB not found');
  }
  if (inp){
    inp.addEventListener('keydown', (e)=>{
      if (e.key==='Enter'){
        console.log('[ui] Enter pressed');
        loadGLBFromDriveIdPublic(inp.value||"");
      }
    });
  } else {
    console.warn('[ui] fileIdInput/inpDriveId not found');
  }
  if (demo){
    demo.addEventListener('click', ()=>{
      console.log('[ui] demo clicked');
      window.dispatchEvent(new CustomEvent('lmy:load-demo'));
    });
  }

  // Material wires (guarded)
  const sel = getEl('selMaterial'); const gi = ()=> parseMatIndex(sel);
  bindRange(getEl('slOpacity'), v => window.app?.viewer?.setOpacity?.(Math.max(0,Math.min(1,v)), gi()));
  bindRange(getEl('slHue'), _ => window.app?.viewer?.setHSL?.(parseFloat(getEl('slHue')?.value||0), parseFloat(getEl('slSat')?.value||0), parseFloat(getEl('slLight')?.value||50), gi()));
  bindRange(getEl('slSat'), _ => window.app?.viewer?.setHSL?.(parseFloat(getEl('slHue')?.value||0), parseFloat(getEl('slSat')?.value||0), parseFloat(getEl('slLight')?.value||50), gi()));
  bindRange(getEl('slLight'), _ => window.app?.viewer?.setHSL?.(parseFloat(getEl('slHue')?.value||0), parseFloat(getEl('slSat')?.value||0), parseFloat(getEl('slLight')?.value||50), gi()));
  console.log('[ui] setupUI done');
}

// Auto-wire with late DOM support
(function autoboot(){
  const trySetup = ()=>{
    try{
      setupUI(window.app || {});
    }catch(e){
      console.warn('[ui] setupUI error (will retry on DOMContentLoaded)', e);
    }
  };
  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', trySetup, { once: true });
  }else{
    trySetup();
  }
  const obs = new MutationObserver(()=>{
    const btn = getEl('btnLoad','btnLoadGLB');
    const inp = getEl('fileIdInput','inpDriveId');
    if (btn && !btn.__lmy_wired){
      btn.__lmy_wired = true;
      btn.addEventListener('click', ()=>{
        console.log('[ui] btnLoad clicked (late)');
        loadGLBFromDriveIdPublic(inp?.value||"");
      });
      console.log('[ui] late-wired btnLoad');
    }
  });
  try{ obs.observe(document.documentElement, { childList:true, subtree:true }); }catch(_){}
})();
