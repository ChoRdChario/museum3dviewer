// ui.js — force Drive API path via dynamic import; fallback only if public
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
  // Try module import first (most reliable)
  try{
    const mod = await import('./utils_drive_api.js');
    if (mod?.fetchDriveFileAsArrayBuffer){
      return await mod.fetchDriveFileAsArrayBuffer(id);
    }
  }catch(_){ /* ignore and try global */ }
  // Try global (if utils loaded via <script type="module"> already)
  if (window.fetchDriveFileAsArrayBuffer){
    return await window.fetchDriveFileAsArrayBuffer(id);
  }
  throw new Error('Drive API helper not loaded');
}
async function loadGLBFromDriveId(app, raw){
  let id = (raw||"").trim();
  if (!id) throw new Error("empty file id/url");
  // normalize /d/<id>/
  const m = id.match(/\/d\/([a-zA-Z0-9_-]{10,})/);
  if (m) id = m[1];
  try{
    // 1) Authorized path (no CORS)
    const buf = await driveApiDownload(id);
    await app.viewer.loadGLB(buf);
    return;
  }catch(e){
    console.warn('[ui] Drive API path failed, will try public fallback if possible:', e);
  }
  // 2) Public fallback (may CORS-fail)
  try{
    const res = await fetch(`https://drive.google.com/uc?export=download&id=${encodeURIComponent(id)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = await res.arrayBuffer();
    await app.viewer.loadGLB(buf);
  }catch(err){
    console.error('[ui] failed to load', err);
    const toast = getEl('toast');
    if (toast){
      toast.textContent = 'Failed to load GLB. Please click "Sign in" (top-right) to authorize Drive access, or make the file public.';
      toast.style.display = 'block';
      setTimeout(()=> toast.style.display='none', 4000);
    }
  }
}
export function setupUI(app){
  const inp = getEl('fileIdInput','inpDriveId');
  const btn = getEl('btnLoad','btnLoadGLB');
  const demo= getEl('btnDemo','btnLoadDemo');
  if (btn) btn.addEventListener('click', ()=> loadGLBFromDriveId(app, inp?.value||""));
  if (inp) inp.addEventListener('keydown', (e)=> (e.key==='Enter') && loadGLBFromDriveId(app, inp.value||""));
  if (demo) demo.addEventListener('click', ()=> window.dispatchEvent(new CustomEvent('lmy:load-demo')));
  // Material wires (guarded)
  const sel = getEl('selMaterial');
  const getIndex = ()=> parseMatIndex(sel);
  bindRange(getEl('slOpacity'), v => app.viewer?.setOpacity?.(Math.max(0,Math.min(1,v)), getIndex()));
  bindRange(getEl('slHue'), _ => app.viewer?.setHSL?.(parseFloat(getEl('slHue')?.value||0), parseFloat(getEl('slSat')?.value||0), parseFloat(getEl('slLight')?.value||50), getIndex()));
  bindRange(getEl('slSat'), _ => app.viewer?.setHSL?.(parseFloat(getEl('slHue')?.value||0), parseFloat(getEl('slSat')?.value||0), parseFloat(getEl('slLight')?.value||50), getIndex()));
  bindRange(getEl('slLight'), _ => app.viewer?.setHSL?.(parseFloat(getEl('slHue')?.value||0), parseFloat(getEl('slSat')?.value||0), parseFloat(getEl('slLight')?.value||50), getIndex()));
  const btnUnlit = getEl('btnUnlit');
  if (btnUnlit){
    btnUnlit.addEventListener('click', ()=>{
      const isOn = btnUnlit.getAttribute('data-on') === '1';
      const next = !isOn;
      app.viewer?.setUnlit?.(next, getIndex());
      btnUnlit.setAttribute('data-on', next ? '1':'0');
      btnUnlit.textContent = next ? 'Unlit: on' : 'Unlit: off';
    });
  }
  const btnDS = getEl('btnDoubleSide');
  if (btnDS){
    btnDS.addEventListener('click', ()=>{
      const isOn = btnDS.getAttribute('data-on') === '1';
      const next = !isOn;
      app.viewer?.setDoubleSide?.(next, getIndex());
      btnDS.setAttribute('data-on', next ? '1':'0');
      btnDS.textContent = next ? 'DoubleSide: on' : 'DoubleSide: off';
    });
  }
  const slWhite = getEl('slWhiteKey'); const chkWhite = getEl('chkWhiteKey');
  if (slWhite){
    const apply = ()=>{
      const t = Math.max(0, Math.min(1, parseFloat(slWhite.value)/100));
      app.viewer?.setWhiteKey?.(t, getIndex());
      if (chkWhite && !chkWhite.checked){ chkWhite.checked = true; app.viewer?.setWhiteKeyEnabled?.(true, getIndex()); }
    };
    slWhite.addEventListener('input', apply); slWhite.addEventListener('change', apply);
  }
  if (chkWhite){ chkWhite.addEventListener('change', ()=> app.viewer?.setWhiteKeyEnabled?.(!!chkWhite.checked, getIndex())); }
}
(function bootstrap(){
  const trySetup = ()=> (window.app && window.app.viewer) && setupUI(window.app);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', trySetup); else trySetup();
  window.addEventListener('lmy:model-loaded', trySetup);
})();
