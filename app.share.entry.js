// LociMyu - app.share.entry.js
// Share entry (Step 3: Sign-in + GLB load + read-only sheet/captions).
// Policy: Share safety is guaranteed by NOT loading write-capable modules.
// Guard remains as an insurance policy.

import './share.fetch.guard.js';
import './boot.share.cdn.js';
import './glb.btn.bridge.share.js';
import './share.sheet.read.js';

function diagPush(...srcs){
  try{
    const d = window.__LM_DIAG || (window.__LM_DIAG = { loaded: [] });
    (d.loaded || (d.loaded=[])).push(...srcs);
  }catch(_e){}
}
diagPush('share.fetch.guard.js','boot.share.cdn.js','glb.btn.bridge.share.js','share.sheet.read.js');

function loadClassic(src){
  return new Promise((resolve, reject)=>{
    const s = document.createElement('script');
    s.src = src;
    s.async = false;
    s.onload = ()=>{ diagPush(src); resolve(); };
    s.onerror = (e)=>reject(e);
    document.head.appendChild(s);
  });
}

function disableWritesUI(){
  // Disable any obvious "create/save" affordances in Share
  const ids = [
    '#save-target-create',
    '#btnSaveView',
    '#btnSaveViewDebounced',
    '#btnRenameSheet',
  ];
  ids.forEach(sel=>{
    const el = document.querySelector(sel);
    if (el){
      el.disabled = true;
      el.style.opacity = '0.5';
      el.style.pointerEvents = 'none';
      el.title = 'Disabled in Share Mode';
    }
  });

  // Disable caption edit inputs (view-only)
  const capInputs = ['#caption-title','#caption-body','#btnRefreshImages'];
  capInputs.forEach(sel=>{
    const el = document.querySelector(sel);
    if (el){
      el.disabled = true;
      el.style.opacity = '0.6';
      el.title = 'View-only in Share Mode';
    }
  });

  // Prevent delete/backspace actions from bubbling into caption UI handlers
  document.addEventListener('keydown', (ev)=>{
    const k = ev.key;
    if (k === 'Delete' || k === 'Backspace'){
      ev.stopImmediatePropagation();
    }
  }, true);
}

function showNotice(){
  const right = document.querySelector('#right') || document.body;
  const box = document.createElement('div');
  box.className = 'panel';
  box.innerHTML = `
    <h4>Share Mode</h4>
    <div class="muted">
      Read-only build. Sheets/Drive writes are blocked by design (write modules are not loaded) and by guard (non-GET blocked).
      <div style="margin-top:6px">Diagnostics: open Console and run <code>__LM_DIAG.loaded</code>.</div>
    </div>
  `;
  // put at top
  right.insertBefore(box, right.firstChild);
}

function ensureTabsWork(){
  // Re-enable tab switching logic (was previously inline in index.html).
  try{
    const tabs = document.querySelectorAll('.tab');
    const panes = document.querySelectorAll('.pane');
    tabs.forEach(t=>t.addEventListener('click', ()=>{
      tabs.forEach(x=>x.classList.toggle('active', x===t));
      panes.forEach(p=>p.classList.toggle('active', p.dataset.pane===t.dataset.tab));
    }));
  }catch(_e){}
}

function hardDisableCaptionAdd(){
  // Block Shift+click add caption by neutralizing viewer bridge hook point.
  document.addEventListener('lm:viewer-bridge-ready', ()=>{
    try{
      const br = window.__lm_viewer_bridge;
      if (br && typeof br.onCanvasShiftPick === 'function'){
        // Replace with no-op registrar
        br.onCanvasShiftPick = function(_cb){
          console.log('[share] blocked onCanvasShiftPick registrar');
        };
      }
    }catch(_e){}
  }, { once:false });
}

async function boot(){
  console.log('[lm-entry] Share entry starting…');

  showNotice();
  ensureTabsWork();
  disableWritesUI();
  hardDisableCaptionAdd();

  // Load safe, read-only UI components (classic scripts)
  // Note: We intentionally DO NOT load caption.sheet.bridge.js or persist modules.
  try{
    await loadClassic('./pin.runtime.bridge.js');
    await loadClassic('./caption.viewer.overlay.js');
    await loadClassic('./caption.ui.controller.js');
  }catch(e){
    console.warn('[lm-entry] failed to load share UI scripts', e);
  }

  console.log('[lm-entry] Share entry ready.');
}

boot();
