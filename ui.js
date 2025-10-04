// ui.js — GLB loading robust: uses Drive API + viewer shim
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
  const fn = ()=>handler(parseFloat(el.value));
  el.addEventListener('input', fn);
  el.addEventListener('change', fn);
}
async function driveApiDownload(id){
  // dynamic import so HTML変更不要
  const mod = await import('./utils_drive_api.js');
  if (!mod?.fetchDriveFileAsArrayBuffer) throw new Error('Drive helper missing');
  return await mod.fetchDriveFileAsArrayBuffer(id);
}
async function ensureViewerShim(){
  try{ await import('./viewer_api_shim.js'); }catch(_){ /* ignore */ }
}
async function loadGLBWithViewer(buf){
  const app = window.app;
  if (!app || !app.viewer) throw new Error('viewer not ready');
  // call the shimmed API
  if (typeof app.viewer.loadGLB !== 'function'){
    await ensureViewerShim();
  }
  if (typeof app.viewer.loadGLB !== 'function'){
    throw new Error('app.viewer.loadGLB not available');
  }
  return await app.viewer.loadGLB(buf);
}
async function loadGLBFromDriveId(app, raw){
  let id = (raw||"").trim();
  if (!id) throw new Error("empty file id/url");
  const m = id.match(/\/d\/([a-zA-Z0-9_-]{10,})/);
  if (m) id = m[1];
  try{
    const buf = await driveApiDownload(id);        // 1) Auth path
    await loadGLBWithViewer(buf);
    return;
  }catch(e){
    console.warn('[ui] Drive API path failed, will try public fallback if possible:', e);
  }
  try{
    const res = await fetch(`https://drive.google.com/uc?export=download&id=${encodeURIComponent(id)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = await res.arrayBuffer();
    await loadGLBWithViewer(buf);
  }catch(err){
    console.error('[ui] failed to load', err);
    const toast = getEl('toast');
    if (toast){
      toast.textContent = 'Failed to load GLB. Please sign in (top-right) or make the file public.';
      toast.style.display = 'block';
      setTimeout(()=> toast.style.display='none', 4000);
    }
  }
}
export function setupUI(app){
  ensureViewerShim();
  const inp = getEl('fileIdInput','inpDriveId');
  const btn = getEl('btnLoad','btnLoadGLB');
  const demo= getEl('btnDemo','btnLoadDemo');
  if (btn) btn.addEventListener('click', ()=> loadGLBFromDriveId(app, inp?.value||""));
  if (inp) inp.addEventListener('keydown', (e)=> (e.key==='Enter') && loadGLBFromDriveId(app, inp.value||""));
  if (demo) demo.addEventListener('click', ()=> window.dispatchEvent(new CustomEvent('lmy:load-demo')));

  // Material wires (guarded stubs on viewer avoid errors)
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
}
(function bootstrap(){
  const trySetup = ()=> (window.app && window.app.viewer) && setupUI(window.app);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', trySetup); else trySetup();
  window.addEventListener('lmy:model-loaded', trySetup);
  window.addEventListener('lmy:viewer-ready', trySetup);
})();
