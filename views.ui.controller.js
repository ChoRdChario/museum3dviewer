/* views.ui.controller.js — Phase 1 (runtime-only)
 * Bind Views tab UI to viewer bridge APIs.
 */
(function(){
  const TAG='[views.ui]';
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
    return '#' + s.toLowerCase();
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
    const stage = document.getElementById('stage') || document.body;
    const c = getComputedStyle(stage).backgroundColor;
    return rgbToHex(c) || '#202124';
  }

  function getBridge(){
    return window.__lm_viewer_bridge || window.viewerBridge || null;
  }

  const elOrtho = $('proj-ortho');
  const elSave  = $('view-save');
  const elBgColor = $('bg-color');
  const elBgHex   = $('bg-hex');
  const elBgReset = $('bg-reset');
  const dirBtns = Array.from(document.querySelectorAll('#pane-views .vdir'));

  if (!elOrtho || !elBgColor || !elBgHex || !elBgReset) {
    warn('Views UI elements not found; abort.');
    return;
  }

  function setEnabled(enabled){
    const dis = !enabled;
    try{ elOrtho.disabled = dis; }catch(_){}
    try{ elBgColor.disabled = dis; }catch(_){}
    try{ elBgHex.disabled = dis; }catch(_){}
    try{ elBgReset.disabled = dis; }catch(_){}
    try{ dirBtns.forEach(b=>b.disabled = dis); }catch(_){}
    // Save view is Phase 2+
    if (elSave) elSave.disabled = true;
  }

  function setBgUiUnset(){
    elBgHex.value = '';
    elBgHex.placeholder = 'unset';
    elBgColor.value = getDefaultCssBg();
    elBgColor.dataset.unset = '1';
  }

  function setBgUiHex(hex){
    const n = normHex(hex);
    if (!n) return setBgUiUnset();
    elBgHex.value = n;
    elBgHex.placeholder = '';
    elBgColor.value = n;
    delete elBgColor.dataset.unset;
  }

  function syncFromViewer(){
    const b = getBridge();
    if (!b) return;
    try{
      if (typeof b.getCameraState === 'function'){
        const cs = b.getCameraState();
        if (cs && cs.type) elOrtho.checked = (cs.type === 'orthographic');
      }
      if (typeof b.getBackgroundColor === 'function'){
        const bg = b.getBackgroundColor();
        if (bg) setBgUiHex(bg);
        else setBgUiUnset();
      } else {
        setBgUiUnset();
      }
    }catch(e){
      warn('syncFromViewer failed', e);
    }
  }

  function enableIfReady(){
    const b = getBridge();
    if (!b) { setEnabled(false); return; }
    // GLB loaded => we should have bounds
    if (typeof b.getModelBounds === 'function'){
      const bd = b.getModelBounds();
      if (bd && bd.center && bd.size){
        setEnabled(true);
        syncFromViewer();
        return;
      }
    }
    // fallback: if scene has meshes
    if (typeof b.getScene === 'function'){
      const sc = b.getScene();
      let meshes = 0;
      try{ sc && sc.traverse(o=>{ if(o && o.isMesh) meshes++; }); }catch(_){}
      if (meshes > 0){
        setEnabled(true);
        syncFromViewer();
        return;
      }
    }
    setEnabled(false);
  }

  function applyProjection(){
    const b = getBridge();
    if (!b || typeof b.setProjection !== 'function') return;
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

    let axis = { x:0, y:0, z:0 };
    switch(String(dir).toLowerCase()){
      case '+x': axis = {x:+1,y:0,z:0}; break;
      case '-x': axis = {x:-1,y:0,z:0}; break;
      case '+y': axis = {x:0,y:+1,z:0}; break;
      case '-y': axis = {x:0,y:-1,z:0}; break;
      case '+z': axis = {x:0,y:0,z:+1}; break;
      case '-z': axis = {x:0,y:0,z:-1}; break;
      default: return;
    }

    const eye = { x:center.x + axis.x*dist, y:center.y + axis.y*dist, z:center.z + axis.z*dist };

    // For top/bottom, use Z-up to reduce roll surprises.
    const up = (dir === '+y' || dir === '-y') ? {x:0,y:0,z:1} : {x:0,y:1,z:0};

    try{
      b.setCameraState({ eye, target:center, up });
    }catch(e){ warn('setCameraState failed', e); }
  }

  // Bind events
  elOrtho.addEventListener('change', applyProjection);

  dirBtns.forEach(btn=>{
    btn.addEventListener('click', ()=>{
      applyDirection(btn.dataset.vdir);
    });
  });

  elBgColor.addEventListener('input', ()=>{
    applyBgHex(elBgColor.value);
  });

  elBgHex.addEventListener('keydown', (ev)=>{
    if (ev.key === 'Enter'){
      const n = normHex(elBgHex.value);
      if (n) applyBgHex(n);
      else syncFromViewer();
      elBgHex.blur();
    }
  });
  elBgHex.addEventListener('blur', ()=>{
    const n = normHex(elBgHex.value);
    if (n) applyBgHex(n);
    else syncFromViewer();
  });

  elBgReset.addEventListener('click', resetBg);

  // Initial state: disabled until scene is ready
  setEnabled(false);
  setBgUiUnset();

  // Enable on scene-ready (fires at init and after GLB load; we re-check readiness)
  window.addEventListener('lm:scene-ready', ()=>setTimeout(enableIfReady, 0));

  // Also re-check after GLB load signal if present
  window.addEventListener('lm:glb-loaded', ()=>setTimeout(enableIfReady, 0));

  // Try a couple times on startup (in case bridge is late)
  setTimeout(enableIfReady, 800);
  setTimeout(enableIfReady, 2000);

  log('armed');
})();