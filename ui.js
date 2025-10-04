// ui.js — robust wiring with fallback (2025-10-05)
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
    buf = await driveApiDownload(id);
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
  window.__lmy_lastGLB = buf;

  // Prefer real viewer if it already exists; otherwise shim will handle it
  try{
    // Lazy import fallback so it's ready for shim too
    await import('./viewer_min_loader.js');
  }catch(_){}
  try{
    // Ensure readiness promise exists so app_boot can show status
    await import('./viewer_ready.js');
  }catch(_){}

  try{
    // Call whatever app.viewer is (real or shim). viewer_api_shim guarantees presence.
    const viewer = (window.app && window.app.viewer);
    if (!viewer || typeof viewer.loadGLB !== 'function'){
      console.warn('[ui] viewer shim not present yet; importing explicitly');
      await import('./viewer_api_shim.js');
    }
    await (window.app.viewer.loadGLB)(buf);
    console.log('[ui] model handed to viewer/shim');
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
