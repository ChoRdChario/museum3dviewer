/* views.ui.controller.share.js — Share (read-only persistence)
 * Bind Views tab UI to viewer bridge APIs, but do NOT persist anything.
 * - Allows runtime-only changes: bg color, projection toggle, camera direction buttons.
 * - Keeps UI in sync with viewer state.
 */
(function(){
  const TAG='[views.ui/share]';
  const log=(...a)=>{ try{console.log(TAG,...a);}catch(_){} };
  const warn=(...a)=>{ try{console.warn(TAG,...a);}catch(_){} };

  const $ = (id)=>document.getElementById(id);

  function normHex(hex){
    if (hex == null) return null;
    let s = String(hex).trim();
    if (!s) return null;
    if (s.startsWith('#')) s = s.slice(1);
    if (s.length === 3) s = s.split('').map(c=>c+c).join('');
    if (!/^[0-9a-fA-F]{6}$/.test(s)) return null;
    return '#'+s.toLowerCase();
  }

  function rgbToHex(rgb){
    if (!rgb) return null;
    const m = String(rgb).match(/rgba?\(([^)]+)\)/i);
    if (!m) return null;
    const parts = m[1].split(',').map(s=>s.trim());
    if (parts.length < 3) return null;
    const r = Math.max(0, Math.min(255, parseInt(parts[0], 10)));
    const g = Math.max(0, Math.min(255, parseInt(parts[1], 10)));
    const b = Math.max(0, Math.min(255, parseInt(parts[2], 10)));
    const to2 = (n)=>n.toString(16).padStart(2,'0');
    return '#' + to2(r) + to2(g) + to2(b);
  }

  function getDefaultCssBg(){
    const stage = document.querySelector('#stage') || document.body;
    const c = window.getComputedStyle(stage).backgroundColor;
    return rgbToHex(c) || '#000000';
  }

  function getBridge(){
    return window.__LM_VIEWER_BRIDGE__ || window.__lm_viewer_bridge || window.__lm_viewerBridge || window.__lm_viewer || null;
  }

  const elOrtho = $('proj-ortho');
  const elBgColor = $('bg-color');
  const elBgHex   = $('bg-hex');
  const elBgReset = $('bg-reset');
  const dirBtns = Array.from(document.querySelectorAll('#pane-views .vdir'));
  const elSave = $('view-save'); // exists in edit; in share keep disabled/hidden

  function setSaveDisabled(){
    if (!elSave) return;
    try{ elSave.disabled = true; }catch(_){}
    try{ elSave.style.opacity = '0.5'; }catch(_){}
    try{ elSave.title = 'Disabled in Share Mode'; }catch(_){}
  }

  function setBgUiUnset(){
    if (!elBgHex || !elBgColor) return;
    elBgHex.value = '';
    elBgHex.placeholder = 'unset';
    elBgColor.value = getDefaultCssBg();
    elBgColor.dataset.unset = '1';
  }

  function setBgUiHex(hex){
    if (!elBgHex || !elBgColor) return;
    const n = normHex(hex);
    if (!n) return setBgUiUnset();
    elBgHex.value = n;
    elBgHex.placeholder = '';
    elBgColor.value = n;
    elBgColor.dataset.unset = '';
  }

  function syncFromViewer(){
    const b = getBridge();
    if (!b) return;
    try{
      if (elOrtho && typeof b.getCameraState === 'function'){
        const cs = b.getCameraState();
        elOrtho.checked = (String(cs?.type||'').toLowerCase() === 'orthographic');
      }
      if (typeof b.getBackgroundColor === 'function'){
        const bg = b.getBackgroundColor(); // hex or null
        if (bg) setBgUiHex(bg);
        else setBgUiUnset();
      }
    }catch(e){
      warn('syncFromViewer failed', e);
    }
  }

  function enableIfReady(){
    const b = getBridge();
    if (!b) return false;
    try{
      if (typeof b.getModelBounds === 'function'){
        const bd = b.getModelBounds();
        if (bd && bd.center && bd.size) return true;
      }
    }catch(_){}
    // fallback: allow anyway if viewer exists
    return true;
  }

  function applyProjection(){
    const b = getBridge();
    if (!b || typeof b.setProjection !== 'function' || !elOrtho) return;
    try{
      b.setProjection(elOrtho.checked ? 'orthographic' : 'perspective');
    }catch(e){ warn('setProjection failed', e); }
    syncFromViewer();
  }

  function applyBgHex(hex){
    const b = getBridge();
    if (!b || typeof b.setBackgroundColor !== 'function') return;
    const n = normHex(hex);
    if (!n) return;
    try{ b.setBackgroundColor(n); }catch(e){ warn('setBackgroundColor failed', e); }
    setBgUiHex(n);
  }

  function resetBg(){
    const b = getBridge();
    if (!b || typeof b.setBackgroundColor !== 'function') return;
    try{ b.setBackgroundColor(''); }catch(e){ warn('reset background failed', e); }
    setBgUiUnset();
  }

  function vecLen(a,b){
    const dx = (a.x||0) - (b.x||0);
    const dy = (a.y||0) - (b.y||0);
    const dz = (a.z||0) - (b.z||0);
    return Math.sqrt(dx*dx + dy*dy + dz*dz);
  }

  function applyDirection(dir){
    const b = getBridge();
    if (!b || typeof b.setCameraState !== 'function' || typeof b.getCameraState !== 'function') return;

    const bounds = (typeof b.getModelBounds === 'function') ? b.getModelBounds() : null;
    const cs = b.getCameraState();
    if (!bounds || !bounds.center || !bounds.size || !cs || !cs.eye || !cs.target) {
      warn('bounds/camera state not ready');
      return;
    }

    const center = { x:+bounds.center.x, y:+bounds.center.y, z:+bounds.center.z };
    const maxDim = Math.max(+bounds.size.x || 0, +bounds.size.y || 0, +bounds.size.z || 0, 1.0);

    const curDist = vecLen(cs.eye, cs.target);
    const dist = Math.max(curDist || 0, maxDim * 1.6, 1.0);

    let axis = null;
    switch(String(dir||'').toLowerCase()){
      case '+x': axis = {x:+1,y:0,z:0}; break;
      case '-x': axis = {x:-1,y:0,z:0}; break;
      case '+y': axis = {x:0,y:+1,z:0}; break;
      case '-y': axis = {x:0,y:-1,z:0}; break;
      case '+z': axis = {x:0,y:0,z:+1}; break;
      case '-z': axis = {x:0,y:0,z:-1}; break;
      default: return;
    }

    const eye = { x:center.x + axis.x*dist, y:center.y + axis.y*dist, z:center.z + axis.z*dist };
    const up = (dir === '+y' || dir === '-y') ? {x:0,y:0,z:1} : {x:0,y:1,z:0};

    try{ b.setCameraState({ eye, target:center, up }); }catch(e){ warn('setCameraState failed', e); }
    syncFromViewer();
  }

  // Bind events
  setSaveDisabled();

  if (elOrtho) elOrtho.addEventListener('change', applyProjection);
  dirBtns.forEach(btn=>{
    btn.addEventListener('click', ()=>{ applyDirection(btn.dataset.vdir); });
  });

  if (elBgColor) elBgColor.addEventListener('input', ()=>{ applyBgHex(elBgColor.value); });
  if (elBgHex){
    elBgHex.addEventListener('keydown', (ev)=>{
      if (ev.key === 'Enter'){
        const n = normHex(elBgHex.value);
        if (n) applyBgHex(n); else syncFromViewer();
        elBgHex.blur();
      }
    });
    elBgHex.addEventListener('blur', ()=>{
      const n = normHex(elBgHex.value);
      if (n) applyBgHex(n); else syncFromViewer();
    });
  }
  if (elBgReset) elBgReset.addEventListener('click', resetBg);

  // Attempt to sync when viewer becomes ready
  const tick = ()=>{
    if (enableIfReady()){
      syncFromViewer();
      return;
    }
    setTimeout(tick, 350);
  };
  setTimeout(tick, 250);

  log('ready (runtime-only)');
})();