// ui.js — delegated click version (2025-10-05)
console.log('[ui] module loaded');

function getEl(idA, idB){ return document.getElementById(idA) || (idB?document.getElementById(idB):null); }

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

  try{ await import('./viewer_api_shim.js'); }catch(_){}
  try{
    await (window.app?.viewer?.loadGLB)(buf);
    console.log('[ui] model handed to viewer/shim');
    const toast = getEl('toast');
    if (toast){
      toast.textContent = 'Model loaded';
      toast.style.display = 'block';
      setTimeout(()=> toast.style.display='none', 1500);
    }
  }catch(e){
    console.error('[ui] failed to show model', e);
  }
}

function hookDirect(inp, btn){
  if (!btn) return;
  if (btn.__lmy_direct) return;
  btn.__lmy_direct = true;
  btn.addEventListener('click', ()=>{
    console.log('[ui] btnLoad clicked');
    loadGLBFromDriveIdPublic(inp?.value||"");
  });
}

export function setupUI(app){
  console.log('[ui] setupUI start');
  const inp = getEl('fileIdInput','inpDriveId');
  const btn = getEl('btnLoad','btnLoadGLB');
  const demo= getEl('btnDemo','btnLoadDemo');

  // direct wire (first attempt)
  hookDirect(inp, btn);

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

// 2) MutationObserver (late wire)
(function(){
  const tryWire = ()=>{
    const inp = getEl('fileIdInput','inpDriveId');
    const btn = getEl('btnLoad','btnLoadGLB');
    hookDirect(inp, btn);
    if (btn && !btn.__lmy_logged){
      btn.__lmy_logged = true;
      console.log('[ui] late-wired btnLoad');
    }
  };
  const obs = new MutationObserver(tryWire);
  try{ obs.observe(document.documentElement, { childList:true, subtree:true }); }catch(_){}
  tryWire();
})();

// 3) Global delegated click (capture phase) — survives shadow DOM / re-render
(function(){
  const handler = (ev)=>{
    const target = ev.target;
    const hit = target.closest ? target.closest('#btnLoad, #btnLoadGLB, [data-lmy="load-glb"]') : null;
    if (!hit) return;
    const inp = getEl('fileIdInput','inpDriveId');
    console.log('[ui] delegated click detected');
    loadGLBFromDriveIdPublic(inp?.value||"");
  };
  window.addEventListener('click', handler, true);
})();

// 4) Console helper
window.LMY = window.LMY || {};
window.LMY.loadNow = ()=>{
  const inp = getEl('fileIdInput','inpDriveId');
  return loadGLBFromDriveIdPublic(inp?.value||"");
};
