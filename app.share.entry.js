// LociMyu - app.share.entry.js
// Share entry (Step 3: Sign-in + GLB load + read-only sheet/captions).
// Policy: Share safety is guaranteed by NOT loading write-capable modules.
// Guard remains as an insurance policy.

import './share.fetch.guard.js';
import './boot.share.cdn.js';
import './glb.btn.bridge.share.js';
import './share.sheet.read.js';
import './share.views.read.js';
import './material.runtime.patch.js';

function diagPush(...srcs){
  try{
    const d = window.__LM_DIAG || (window.__LM_DIAG = { loaded: [] });
    (d.loaded || (d.loaded=[])).push(...srcs);
  }catch(_e){}
}
diagPush('share.fetch.guard.js','boot.share.cdn.js','glb.btn.bridge.share.js','share.sheet.read.js','share.views.read.js','material.runtime.patch.js');

// --- Share-mode diagnostics & UX affordances (Step 7) ---
const __LM_SHARE_FORBIDDEN = [
  'boot.esm.cdn.js',
  'save.locator.js',
  'materials.sheet.persist.js',
  'caption.sheet.bridge.js',
  'caption.sheet.selector.js',
  'sheet-rename.module.js',
  'views.ui.controller.js',
  'auto.apply.soft.patch.js',
  'glb.btn.bridge.v3.js',
  'persist.guard.js'
];

function __lm_shareLoadedList(){
  try{
    const d = window.__LM_DIAG || {};
    return Array.isArray(d.loaded) ? d.loaded.slice() : [];
  }catch(_e){
    return [];
  }
}

function __lm_shareEnsureBadge(){
  try{
    if (document.getElementById('lm-share-badge')) return;

    if (!document.getElementById('lm-share-badge-style')){
      const st = document.createElement('style');
      st.id = 'lm-share-badge-style';
      st.textContent = `
        #lm-share-badge{
          position: fixed;
          top: 10px;
          right: 10px;
          z-index: 99999;
          padding: 6px 10px;
          border-radius: 999px;
          font: 12px/1.2 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
          letter-spacing: .2px;
          background: rgba(30,30,30,.86);
          color: #fff;
          border: 1px solid rgba(255,255,255,.14);
          box-shadow: 0 6px 18px rgba(0,0,0,.35);
          user-select: none;
          pointer-events: none;
        }
        #lm-share-warning{
          position: fixed;
          top: 44px;
          right: 10px;
          z-index: 99999;
          max-width: 420px;
          padding: 10px 12px;
          border-radius: 12px;
          font: 12px/1.35 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
          background: rgba(180,40,40,.92);
          color: #fff;
          border: 1px solid rgba(255,255,255,.18);
          box-shadow: 0 10px 22px rgba(0,0,0,.35);
        }
        #lm-share-warning code{ background: rgba(0,0,0,.25); padding: 1px 4px; border-radius: 6px; }
      `;
      document.head.appendChild(st);
    }

    const badge = document.createElement('div');
    badge.id = 'lm-share-badge';
    badge.textContent = 'Share (read-only: no saves)';
    document.body.appendChild(badge);
  }catch(_e){}
}

function __lm_shareShowWarning(forbiddenHits){
  try{
    if (document.getElementById('lm-share-warning')) return;
    const box = document.createElement('div');
    box.id = 'lm-share-warning';
    const list = (forbiddenHits || []).slice(0, 8).map(s=>`<code>${String(s)}</code>`).join(' ');
    box.innerHTML = `
      <div style="font-weight:700;margin-bottom:6px">Share safety warning</div>
      <div style="opacity:.95">
        Forbidden write-capable modules appear to be loaded:
        <div style="margin-top:6px">${list || '<code>(unknown)</code>'}</div>
        <div style="margin-top:8px;opacity:.9">
          Check <code>__LM_DIAG.loaded</code> and the Share entry load list.
        </div>
      </div>
    `;
    document.body.appendChild(box);
  }catch(_e){}
}

function __lm_shareRunStartupDiagnostics(){
  const loaded = __lm_shareLoadedList();
  const hits = __LM_SHARE_FORBIDDEN.filter(f => loaded.some(s => (s || '').includes(f)));
  if (hits.length){
    console.error('[share][diag] forbidden modules loaded:', hits, loaded);
    __lm_shareShowWarning(hits);
    return false;
  }
  console.log('[share][diag] ok (no forbidden modules detected)');
  return true;
}
// --- /Share-mode diagnostics & UX affordances ---

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


function wireTabs(){
  try{
    const tabs = Array.from(document.querySelectorAll('nav[role="tablist"] [role="tab"][data-tab]'));
    const panes = Array.from(document.querySelectorAll('section.pane[data-pane]'));
    if (!tabs.length || !panes.length){
      console.warn('[share] tab wiring: tabs/panes not found');
      return;
    }

    function activate(name){
      tabs.forEach(btn=>{
        const on = (btn.dataset.tab === name);
        btn.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      panes.forEach(p=>{
        const on = (p.dataset.pane === name);
        p.setAttribute('data-active', on ? 'true' : 'false');
      });
    }

    tabs.forEach(btn=>{
      btn.addEventListener('click', (ev)=>{
        ev.preventDefault();
        ev.stopPropagation();
        activate(btn.dataset.tab || 'caption');
      }, {capture:true});
    });

    const initial = (tabs.find(b=>b.getAttribute('aria-selected') === 'true') || tabs[0])?.dataset?.tab || 'caption';
    activate(initial);
    console.log('[share] tab wiring ok');
  }catch(e){
    console.warn('[share] tab wiring failed', e);
  }
}

function disableWritesUI(){
  // Disable any obvious "create/save" affordances in Share
  const ids = [
    '#save-target-create',
    '#btnSaveView',
    '#btnSaveViewDebounced',
    '#btnRenameSheet',
    '#view-save',
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

  // Disable caption text edits (view-only)
  // NOTE: Images refresh is read-only and safe, so we keep it enabled.
  const capInputs = ['#caption-title','#caption-body'];
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

function disableCaptionDeleteUI(){
  // Share is view-only: prevent accidental removal from the in-memory list.
  // caption.ui.controller.js renders a "×" delete button that calls removeItem().
  // We keep the shared controller and hard-disable only this affordance in Share.
  try{
    const style = document.createElement('style');
    style.setAttribute('data-lm-share', 'caption-delete-off');
    style.textContent = `
      #pane-caption #caption-list .lm-cap-del {
        display: none !important;
        pointer-events: none !important;
      }
    `;
    document.head.appendChild(style);
  }catch(_e){}

  // Extra safety: block clicks even if CSS is overridden.
  document.addEventListener('click', (ev)=>{
    try{
      const t = ev.target;
      const btn = t && t.closest ? t.closest('#pane-caption #caption-list .lm-cap-del') : null;
      if (!btn) return;
      ev.preventDefault();
      ev.stopImmediatePropagation();
      console.log('[share] delete disabled (caption list)');
    }catch(_e){}
  }, true);
}

function disableCaptionImageAttachUI(){
  // Share is view-only: prevent attaching/detaching images to captions.
  // We still load and show the image gallery and preview for existing attachments.
  try{
    const style = document.createElement('style');
    style.setAttribute('data-lm-share', 'caption-image-attach-off');
    style.textContent = `
      #pane-caption #images-grid .lm-img-item { cursor: default !important; }
      #pane-caption #images-grid .lm-img-item button { display:none !important; }
    `;
    document.head.appendChild(style);
  }catch(_e){}

  // Capture clicks before caption.ui.controller handlers.
  document.addEventListener('click', (ev)=>{
    try{
      const t = ev.target;
      const item = t && t.closest ? t.closest('#pane-caption #images-grid .lm-img-item') : null;
      if (!item) return;
      ev.preventDefault();
      ev.stopImmediatePropagation();
      // No-op: gallery is for viewing only in Share.
    }catch(_e){}
  }, true);
}

function showNotice(){
  // Compact, single-line notice (Option B): keep the UI unobtrusive.
  // Detailed explanation is available via an info tooltip.
  const right = document.querySelector('#right') || document.body;

  try{
    // One-time style for the notice line.
    if (!document.querySelector('style[data-lm-share="notice-line"]')){
      const st = document.createElement('style');
      st.setAttribute('data-lm-share', 'notice-line');
      st.textContent = `
        .lm-share-notice-line{
          display:flex; align-items:center; gap:10px;
          padding:8px 12px; margin:10px 10px 0;
          border:1px solid rgba(255,255,255,.12);
          border-radius:12px;
          background: rgba(255,255,255,.04);
          color: rgba(255,255,255,.88);
          font-size:12px; line-height:1.2;
        }
        .lm-share-notice-line .lm-share-notice-text{ white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .lm-share-notice-line .lm-share-notice-info{
          margin-left:auto;
          width:22px; height:22px; padding:0;
          display:inline-flex; align-items:center; justify-content:center;
          border-radius:999px;
          border:1px solid rgba(255,255,255,.18);
          background: rgba(0,0,0,.12);
          color: rgba(255,255,255,.82);
          font-weight:600;
          cursor:help;
        }
        .lm-share-notice-line .lm-share-notice-info:focus{ outline:2px solid rgba(255,255,255,.22); outline-offset:2px; }
      `;
      document.head.appendChild(st);
    }
  }catch(_e){}

  const line = document.createElement('div');
  line.className = 'lm-share-notice-line';
  const text = document.createElement('div');
  text.className = 'lm-share-notice-text';
  text.textContent = 'Share (read-only; no saves)';

  const info = document.createElement('button');
  info.type = 'button';
  info.className = 'lm-share-notice-info';
  info.textContent = 'i';
  info.title = [
    'Read-only build.',
    'Sheets/Drive writes are blocked by design (write modules are not loaded) and by guard (non-GET blocked).',
    'Diagnostics: open Console and run __LM_DIAG.loaded.'
  ].join(' ');

  line.appendChild(text);
  line.appendChild(info);
  right.insertBefore(line, right.firstChild);
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
  __lm_shareEnsureBadge();
  __lm_shareRunStartupDiagnostics();

  showNotice();
  ensureTabsWork();
  disableWritesUI();
  wireTabs();
  disableCaptionDeleteUI();
  disableCaptionImageAttachUI();
  hardDisableCaptionAdd();

  // Load safe, read-only UI components (classic scripts)
  // Note: We intentionally DO NOT load caption.sheet.bridge.js or persist modules.
  try{
    await loadClassic('./pin.runtime.bridge.js');
    await loadClassic('./caption.viewer.overlay.js');
    await loadClassic('./caption.ui.controller.js');
    // Read-only image listing (Drive folder siblings). Safe: GET-only via Share auth fetch.
    await loadClassic('./caption.images.loader.js');
    await loadClassic('./views.ui.controller.share.js');

    // Material tab (read-only persistence):
    // - dropdown population (scene -> #materialSelect)
    // - orchestrator applies sheet values (if present) and allows local tweaks (no save)
    await loadClassic('./material.dropdown.sync.v1.js');
    await loadClassic('./material.orchestrator.js');
  }catch(e){
    console.warn('[lm-entry] failed to load share UI scripts', e);
  }

  console.log('[lm-entry] Share entry ready.');
}

boot();
