// ui.js — exports setupUI(app) and wires GLB loading controls.
/* global normalizeDriveIdFromInput, fetchDriveFileAsArrayBuffer */
function parseMatIndex(sel){
  if (!sel) return null;
  const v = sel.value || sel.options?.[sel.selectedIndex]?.value || "";
  if (v === "(All)" || v === "" || v == null) return null;
  const num = parseInt(String(v).split(":")[0], 10);
  return Number.isFinite(num) ? num : null;
}
function bindRange(el, handler){
  if (!el) return;
  const fn = ()=>handler(parseFloat(el.value));
  el.addEventListener('input', fn);
  el.addEventListener('change', fn);
}
function ensureMatOptions(app){
  const sel = document.getElementById('selMaterial');
  if (!sel || !app?.viewer?.getMaterials) return;
  const mats = app.viewer.getMaterials?.() || [];
  const current = sel.value;
  sel.innerHTML = "";
  const optAll = document.createElement('option');
  optAll.textContent = '(All)'; optAll.value = '(All)';
  sel.appendChild(optAll);
  mats.forEach((m,i)=>{
    const opt = document.createElement('option');
    opt.value = `${i}: ${m.name||('mat.'+i)}`;
    opt.textContent = opt.value;
    sel.appendChild(opt);
  });
  [...sel.options].some((o)=> (o.value===current && (sel.value=current,true)));
}

async function loadGLBFromDriveId(app, raw){
  try{
    const id = (window.normalizeDriveIdFromInput? window.normalizeDriveIdFromInput(raw): raw)||"";
    if (!id) throw new Error("empty file id/url");
    // Prefer Drive API util if present
    if (window.fetchDriveFileAsArrayBuffer){
      const buf = await window.fetchDriveFileAsArrayBuffer(id);
      await app.viewer.loadGLB(buf);
    }else if (app.viewer.loadGLBFromDriveId){
      await app.viewer.loadGLBFromDriveId(id);
    }else{
      // fallback to uc?export=download (may hit CORS for non-public)
      const res = await fetch(`https://drive.google.com/uc?export=download&id=${encodeURIComponent(id)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = await res.arrayBuffer();
      await app.viewer.loadGLB(buf);
    }
  }catch(err){
    console.error('[ui] failed to load', err);
    const toast = document.getElementById('toast');
    if (toast){
      toast.textContent = `Failed to load GLB: ${err.message||err}`;
      toast.style.display = 'block';
      setTimeout(()=> toast.style.display='none', 3000);
    }
  }
}

export function setupUI(app){
  if (!app || !app.viewer) return;

  // --- GLB loaders ---
  const inp = (document.getElementById('fileIdInput')||document.getElementById('inpDriveId'));
  const btn = (document.getElementById('btnLoad')||document.getElementById('btnLoadGLB'));
  const btnd = (document.getElementById('btnLoadDemo')||document.getElementById('btnDemo'));
  if (btn){
    btn.addEventListener('click', ()=> loadGLBFromDriveId(app, inp?.value||""));
  }
  if (inp){
    inp.addEventListener('keydown', (e)=>{
      if (e.key === 'Enter') loadGLBFromDriveId(app, inp.value||"");
    });
  }
  if (btnd){
    btnd.addEventListener('click', ()=>{
      window.dispatchEvent(new CustomEvent('lmy:load-demo'));
    });
  }

  // --- Materials UI ---
  ensureMatOptions(app);
  window.addEventListener('lmy:model-loaded', ()=> ensureMatOptions(app));
  const getIndex = ()=> parseMatIndex(document.getElementById('selMaterial'));
  bindRange(document.getElementById('slHue'),  v => app.viewer.setHSL?.(v,   parseFloat(document.getElementById('slSat')?.value||0), parseFloat(document.getElementById('slLight')?.value||50), getIndex()));
  bindRange(document.getElementById('slSat'),  _ => app.viewer.setHSL?.(parseFloat(document.getElementById('slHue')?.value||0),  parseFloat(document.getElementById('slSat')?.value||0), parseFloat(document.getElementById('slLight')?.value||50), getIndex()));
  bindRange(document.getElementById('slLight'),_ => app.viewer.setHSL?.(parseFloat(document.getElementById('slHue')?.value||0),  parseFloat(document.getElementById('slSat')?.value||0), parseFloat(document.getElementById('slLight')?.value||50), getIndex()));
  bindRange(document.getElementById('slOpacity'), v => app.viewer.setOpacity?.(Math.max(0, Math.min(1, v)), getIndex()));
  const btnUnlit = document.getElementById('btnUnlit');
  if (btnUnlit){
    btnUnlit.addEventListener('click', ()=>{
      const isOn = btnUnlit.getAttribute('data-on') === '1';
      const next = !isOn;
      app.viewer.setUnlit?.(next, getIndex());
      btnUnlit.setAttribute('data-on', next ? '1':'0');
      btnUnlit.textContent = next ? 'Unlit: on' : 'Unlit: off';
    });
  }
  const btnDS = document.getElementById('btnDoubleSide');
  if (btnDS){
    btnDS.addEventListener('click', ()=>{
      const isOn = btnDS.getAttribute('data-on') === '1';
      const next = !isOn;
      app.viewer.setDoubleSide?.(next, getIndex());
      btnDS.setAttribute('data-on', next ? '1':'0');
      btnDS.textContent = next ? 'DoubleSide: on' : 'DoubleSide: off';
    });
  }
  const slWhite = document.getElementById('slWhiteKey');
  const chkWhite = document.getElementById('chkWhiteKey');
  if (slWhite){
    const apply = ()=>{
      const t = Math.max(0, Math.min(1, parseFloat(slWhite.value)/100));
      app.viewer.setWhiteKey?.(t, getIndex());
      if (chkWhite && !chkWhite.checked){
        chkWhite.checked = true;
        app.viewer.setWhiteKeyEnabled?.(true, getIndex());
      } else if (!chkWhite){
        app.viewer.setWhiteKeyEnabled?.(true, getIndex());
      }
    };
    slWhite.addEventListener('input', apply);
    slWhite.addEventListener('change', apply);
  }
  if (chkWhite){
    chkWhite.addEventListener('change', ()=> app.viewer.setWhiteKeyEnabled?.(!!chkWhite.checked, getIndex()));
  }
}

// Auto-wire on ready/model-loaded (idempotent)
(function bootstrap(){
  const trySetup = ()=> (window.app && window.app.viewer) && setupUI(window.app);
  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', trySetup);
  }else{
    trySetup();
  }
  window.addEventListener('lmy:model-loaded', trySetup);
})();
