
// [viewer-expose v1.0] — binds viewer.bridge.module API to window.__lm_viewer_bridge
// Load order: after viewer.bridge.module.js, before pin.runtime.bridge.js
(async () => {
  try {
    const m = await import('./viewer.bridge.module.js');
    const keys = [
      'addPinMarker','clearPins','ensureViewer','getScene','listMaterials',
      'loadGlbFromDrive','onCanvasShiftPick','onPinSelect','onRenderTick',
      'projectPoint','removePinMarker','resetAllMaterials','resetMaterial',
      'setCurrentGlbId','setPinSelected','applyMaterialProps'
    ];
    const bridge = {};
    for (const k of keys) {
      if (typeof m[k] === 'function') bridge[k] = m[k];
    }
    // Fallback: if the module exports a default object containing the API
    if (!Object.keys(bridge).length && m && typeof m.default === 'object') {
      for (const [k, v] of Object.entries(m.default)) {
        if (typeof v === 'function') bridge[k] = v;
      }
    }
    // Last resort: copy any function exports
    if (!Object.keys(bridge).length) {
      for (const [k, v] of Object.entries(m)) {
        if (typeof v === 'function') bridge[k] = v;
      }
    }
    window.__lm_viewer_bridge = bridge;
    console.log('[viewer-expose] bound keys:', Object.keys(bridge));
    document.dispatchEvent(new Event('lm:viewer-bridge-ready'));
  } catch (e) {
    console.warn('[viewer-expose] failed to bind viewer bridge:', e);
  }
})();
