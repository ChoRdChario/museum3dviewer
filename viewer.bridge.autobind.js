
// viewer.bridge.autobind.js
// Minimal, non-invasive autobinder: finds an existing viewer bridge object
// (must expose addPinMarker & clearPins), publishes to window.__lm_viewer_bridge,
// and emits a readiness event.
(function(){
  const READY_EVENT = 'lm:viewer-bridge-ready';
  if (window.__lm_viewer_bridge && typeof window.__lm_viewer_bridge.addPinMarker === 'function') {
    console.log('[viewer-bridge] existing __lm_viewer_bridge detected');
    document.dispatchEvent(new Event(READY_EVENT));
    return;
  }

  function tryBindOnce() {
    try {
      for (const k of Object.keys(window)) {
        const v = window[k];
        if (!v || typeof v !== 'object') continue;
        if (typeof v.addPinMarker === 'function' && typeof v.clearPins === 'function') {
          window.__lm_viewer_bridge = v;
          console.log('[viewer-bridge] autobound from window.' + k);
          document.dispatchEvent(new Event(READY_EVENT));
          return true;
        }
      }
    } catch (e) {}
    return false;
  }

  if (!tryBindOnce()) {
    let tries = 0;
    const maxTries = 50; // ~5s @100ms
    const t = setInterval(() => {
      tries++;
      if (tryBindOnce() || tries >= maxTries) clearInterval(t);
    }, 100);
  }
})();
