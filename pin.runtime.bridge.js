
// pin.runtime.bridge.js
// Robust binder that waits for window.__lm_viewer_bridge and wires basic pin draw.
// It does NOT change your UI flows; it only ensures the bridge is present before use.
(function(){
  const TAG = '[pin-bridge]';
  const READY_EVENT = 'lm:viewer-bridge-ready';

  let bridge = null;
  let bindResolved = false;

  function hasBridge(obj){
    return obj && typeof obj.addPinMarker === 'function' && typeof obj.clearPins === 'function';
  }

  function bindNow(){
    if (bindResolved) return true;
    if (hasBridge(window.__lm_viewer_bridge)) {
      bridge = window.__lm_viewer_bridge;
      console.log(TAG, 'viewer bound = true');
      bindResolved = true;
      // optional hook: trigger a redraw for anyone listening
      document.dispatchEvent(new Event('lm:pins-bridge-bound'));
      return true;
    }
    return false;
  }

  // Attempt immediate bind
  if (!bindNow()) {
    console.log(TAG, 'waiting viewer bridge...');
    // 1) react to explicit ready event
    const onReady = () => { bindNow(); };
    document.addEventListener(READY_EVENT, onReady, { once: true });

    // 2) timed polling fallback (handles race without requiring HTML changes)
    let tries = 0;
    const max = 60; // ~6s
    const id = setInterval(() => {
      tries++;
      if (bindNow() || tries >= max) {
        clearInterval(id);
        if (!bindResolved) {
          console.warn(TAG, 'bind failed: viewer bridge timeout');
        }
      }
    }, 100);
  }

  // Public, defensive wrappers (no-ops until bound)
  window.__lm_pin_bridge = {
    addPinMarkerSafe(pin){
      if (!bindResolved) return false;
      try { bridge.addPinMarker(pin); return true; } catch(e){ console.warn(TAG, 'addPinMarker failed', e); }
      return false;
    },
    clearPinsSafe(){
      if (!bindResolved) return false;
      try { bridge.clearPins(); return true; } catch(e){ console.warn(TAG, 'clearPins failed', e); }
      return false;
    }
  };

  console.log(TAG, 'armed');
})();
