// ui.js — prefer Drive API download (authorized), fallback only if public.
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
async function loadGLBFromDriveId(app, raw){
  const id = (raw||"").trim();
  try{
    if (window.fetchDriveFileAsArrayBuffer){
      const buf = await window.fetchDriveFileAsArrayBuffer(id);
      await app.viewer.loadGLB(buf);
      return;
    }
    // Public fallback (may CORS fail)
    const m = id.match(/\/d\/([a-zA-Z0-9_-]{10,})/);
    const fileId = m? m[1] : id;
    const res = await fetch(`https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = await res.arrayBuffer();
    await app.viewer.loadGLB(buf);
  }catch(err){
    console.error('[ui] failed to load', err);
    const toast = getEl('toast');
    if (toast){
      if (String(err).includes('CORS') || String(err).includes('401') || String(err).includes('403')){
        toast.textContent = 'Sign in required: please click "Sign in" (top-right) and allow Drive access.';
      }else{
        toast.textContent = `Failed to load GLB: ${err.message||err}`;
      }
      toast.style.display = 'block';
      setTimeout(()=> toast.style.display='none', 3500);
    }
  }
}
export function setupUI(app){
  // Buttons / inputs (support legacy ids)
  const inp = getEl('fileIdInput','inpDriveId');
  const btn = getEl('btnLoad','btnLoadGLB');
  const demo= getEl('btnDemo','btnLoadDemo');
  if (btn){
    btn.addEventListener('click', ()=> loadGLBFromDriveId(app, inp?.value||""));
  }
  if (inp){
    inp.addEventListener('keydown', (e)=> (e.key==='Enter') && loadGLBFromDriveId(app, inp.value||""));
  }
  if (demo){
    demo.addEventListener('click', ()=> window.dispatchEvent(new CustomEvent('lmy:load-demo')));
  }
  // Material wires stay as-is (guarded)
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
