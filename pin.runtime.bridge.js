
// [pin.runtime.bridge] Phase A0: small shim that proxies to viewer bridge if present
(function(){
  const TAG='[pin.runtime.bridge]';
  const log=(...a)=>console.log(TAG,...a);
  const warn=(...a)=>console.warn(TAG,...a);

  function getViewer(){
    return window.__lm_viewer_bridge || null;
  }

  const api = {
    addPin(item){ const v=getViewer(); if(v && v.addPinMarker) return v.addPinMarker(item); },
    removePin(item){ const v=getViewer(); if(v && v.removePinMarker) return v.removePinMarker(item); },
    setSelected(id){ const v=getViewer(); if(v && v.setPinSelected) return v.setPinSelected(id); }
  };

  window.__LM_PIN_BRIDGE = api;
  log('armed');
})();
