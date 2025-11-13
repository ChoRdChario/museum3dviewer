
// [pin-bridge v2.0] — waits for viewer-expose and provides a tiny pin API
console.log('[pin-bridge] armed');

function waitForViewerBridge(timeout = 6000) {
  return new Promise((resolve, reject) => {
    if (window.__lm_viewer_bridge) return resolve(window.__lm_viewer_bridge);
    const onReady = () => {
      cleanup(); 
      resolve(window.__lm_viewer_bridge);
    };
    const to = setTimeout(() => {
      cleanup();
      reject(new Error('viewer bridge timeout'));
    }, timeout);
    function cleanup() {
      document.removeEventListener('lm:viewer-bridge-ready', onReady);
      clearTimeout(to);
    }
    document.addEventListener('lm:viewer-bridge-ready', onReady, { once: true });
  });
}

(async () => {
  try {
    const vb = await waitForViewerBridge();
    console.log('[pin-bridge] viewer bound =', !!vb);
    // Expose a stable, minimal API for the caption controller
    window.__lm_pin_api = {
      addPinMarker: (...args) => vb?.addPinMarker?.(...args),
      clearPins:    (...args) => vb?.clearPins?.(...args),
      setPinSelected: (...args) => vb?.setPinSelected?.(...args),
    };
    document.dispatchEvent(new Event('lm:pin-api-ready'));
  } catch (e) {
    console.warn('[pin-bridge] bind failed:', e);
  }
})();
