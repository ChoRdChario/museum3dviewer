// features/wiring_viewer_bridge.js
// Viewer ←→ Cloud pins & Overlay wiring (drop-in)
// - listens: lmy:cloud-ready, lmy:add-pin, lmy:pick-pin, lmy:deselect-pin, lmy:image-picked
// - uses: window.__LMY_cloudPins (getPins, saveNewPin, decoratePin)
// - shows overlay via window.__LMY_overlay

(function(){
  const S = {
    ctx: null,
    images: [],
    pins: [],
    selected: null,
  };

  function log(...a){ console.log('[viewer-bridge]', ...a); }
  function warn(...a){ console.warn('[viewer-bridge]', ...a); }
  function V(){ return window.__LMY_viewer || window.viewer || window; }

  // ---- helpers to interact with various viewer APIs safely ----
  function viewerAddPin(pin){ // {id,x,y,z,title,body,imageId}
    const v = V();
    if (v.pins?.addFromWorld) return v.pins.addFromWorld(pin);
    if (typeof v.addPinFromWorld === 'function') return v.addPinFromWorld(pin);
    // Fallback: broadcast for app-specific handler
    document.dispatchEvent(new CustomEvent('lmy:render-pin', { detail: pin }));
  }
  function viewerRenderPins(pins){
    pins.forEach(p => viewerAddPin(p));
  }
  function viewerGetSelected(){
    const v = V();
    if (v.pins?.getSelected) return v.pins.getSelected();
    return S.selected || null;
  }
  function viewerSetSelected(pin){
    S.selected = pin || null;
    const v = V();
    if (v.pins?.setSelected) { try{ v.pins.setSelected(pin); }catch{} }
  }

  // ---- overlay helpers ----
  async function showOverlayForPin(pin){
    try{
      const deco = await window.__LMY_cloudPins?.decoratePin?.(pin) ?? pin;
      window.__LMY_overlay?.showOverlay?.(deco);
    }catch(e){ warn('overlay failed', e); }
  }
  function hideOverlay(){
    window.__LMY_overlay?.hideOverlay?.();
  }

  // ---- events from cloud bootstrap ----
  document.addEventListener('lmy:cloud-ready', (e)=>{
    const { ctx, images, pins } = e.detail || {};
    S.ctx = ctx || null;
    S.images = images || [];
    S.pins = Array.isArray(pins) ? pins.slice() : [];
    log('cloud-ready: pins', S.pins.length, 'images', S.images.length);

    // image grid hook (if app provided)
    if (window.__LMY_renderImageGrid && Array.isArray(S.images)){
      try{ window.__LMY_renderImageGrid(S.images); }catch{}
    }

    // render existing pins into viewer
    viewerRenderPins(S.pins);
  });

  // ---- add pin (from viewer; phase2a fires lmy:add-pin) ----
  document.addEventListener('lmy:add-pin', async (e)=>{
    const { x, y, z } = e.detail || {};
    if ([x,y,z].some(v => typeof v !== 'number')) return warn('add-pin malformed', e.detail);

    const pin = { id:'', x, y, z, title:'', body:'', imageId:'' };
    try{
      const id = await window.__LMY_cloudPins?.saveNewPin?.(pin);
      if (id) pin.id = id;
    }catch(err){ warn('saveNewPin failed', err); }

    viewerAddPin(pin);
    viewerSetSelected(pin);
    showOverlayForPin(pin);
  }, { capture:true });

  // ---- pick pin (from viewer) ----
  document.addEventListener('lmy:pick-pin', async (e)=>{
    const pin = e.detail;
    if (!pin) return;
    viewerSetSelected(pin);
    showOverlayForPin(pin);
  }, { capture:true });

  document.addEventListener('lmy:deselect-pin', ()=>{
    viewerSetSelected(null);
    hideOverlay();
  }, { capture:true });

  // ---- image chosen from grid ----
  document.addEventListener('lmy:image-picked', async (e)=>{
    const file = e.detail; // {id,name,thumbnailLink,...}
    if (!file?.id) return;
    const sel = viewerGetSelected();
    if (!sel) return;
    sel.imageId = file.id;
    showOverlayForPin(sel);
  }, { capture:true });

  // expose (optional)
  window.__LMY_viewerBridge = {
    get ctx(){ return S.ctx; },
    get images(){ return S.images.slice(); },
    get pins(){ return S.pins.slice(); },
    getSelected: viewerGetSelected,
    setSelected: viewerSetSelected,
    renderPins: viewerRenderPins,
  };

  log('mounted');
})();
