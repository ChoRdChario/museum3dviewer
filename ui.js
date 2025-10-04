// ui.js — robust wiring & verbose logs (2025-10-05)
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
  if (!viewer) throw new Error('viewer not ready');
  await ensureViewerShim();
  if (typeof viewer.loadGLB !== 'function') throw new Error('app.viewer.loadGLB not available');
  return await viewer.loadGLB(buf);
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
    console.log('[ui] Drive API download ok', id);
  }catch(e){
    console.warn('[ui] Drive API download failed:', e);
    try{
      const res = await fetch(`https://drive.google.com/uc?export=download&id=${encodeURIComponent(id)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      buf = await res.arrayBuffer();
      console.log('[ui] public uc download ok', id);
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
  try{
    await loadGLBWithViewer(buf);
    console.log('[ui] model handed to viewer');
  }catch(e){
    if (String(e.message||e).includes('viewer not ready')){
      console.warn('[ui] viewer not ready, will queue');
      try{ await import('./viewer_ready.js'); }catch(_){}
      if (window.__viewerReadyPromise){
        window.__viewerReadyPromise.then(()=> loadGLBWithViewer(buf).then(()=> console.log('[ui] queued model loaded')));
        const toast = getEl('toast');
        if (toast){
          toast.textContent = 'Preparing viewer... will load model automatically.';
          toast.style.display = 'block';
          setTimeout(()=> toast.style.display='none', 2000);
        }
        return;
      }
    }
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

  const btnUnlit = getEl('btnUnlit');
  if (btnUnlit){
    btnUnlit.addEventListener('click', ()=>{
      const isOn = btnUnlit.getAttribute('data-on') === '1';
      const next = !isOn;
      window.app?.viewer?.setUnlit?.(next, gi());
      btnUnlit.setAttribute('data-on', next ? '1':'0');
      btnUnlit.textContent = next ? 'Unlit: on' : 'Unlit: off';
    });
  }
  const btnDS = getEl('btnDoubleSide');
  if (btnDS){
    btnDS.addEventListener('click', ()=>{
      const isOn = btnDS.getAttribute('data-on') === '1';
      const next = !isOn;
      window.app?.viewer?.setDoubleSide?.(next, gi());
      btnDS.setAttribute('data-on', next ? '1':'0');
      btnDS.textContent = next ? 'DoubleSide: on' : 'DoubleSide: off';
    });
  }
  const slWhite = getEl('slWhiteKey'); const chkWhite = getEl('chkWhiteKey');
  if (slWhite){
    const apply = ()=>{
      const t = Math.max(0, Math.min(1, parseFloat(slWhite.value)/100));
      window.app?.viewer?.setWhiteKey?.(t, gi());
      if (chkWhite && !chkWhite.checked){ chkWhite.checked = true; window.app?.viewer?.setWhiteKeyEnabled?.(true, gi()); }
    };
    slWhite.addEventListener('input', apply); slWhite.addEventListener('change', apply);
  }
  if (chkWhite){ chkWhite.addEventListener('change', ()=> window.app?.viewer?.setWhiteKeyEnabled?.(!!chkWhite.checked, gi())); }
  console.log('[ui] setupUI done');
}

// Auto-wire even if app is not ready yet
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

  // As a safety, if elements appear later (SPA), watch mutations
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

// Provide a global helper for inline onclick fallback
window.loadGLBFromInput = function(){
  const inp = getEl('fileIdInput','inpDriveId');
  console.log('[ui] loadGLBFromInput called');
  return loadGLBFromDriveIdPublic(inp?.value||"");
};
