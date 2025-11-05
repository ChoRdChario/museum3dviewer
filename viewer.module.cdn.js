// viewer.module.cdn.js - safe shim layer (ESM)
// Ensures boot.esm.cdn.js can import expected named exports without hard-coupling.
// Delegates to window.lm implementations when present; otherwise provides safe no-ops.

const _log = (...a) => console.log('[viewer-shim]', ...a);

// Keep an internal scene reference as a fallback for getScene()
let _scene = null;

function _lm() {
  // Ensure a single global namespace object exists.
  const g = (window.lm ||= {});
  return g;
}

function _delegate(name, fallback) {
  const g = _lm();
  const fn = g && typeof g[name] === 'function' ? g[name] : null;
  if (fn) return fn;
  return typeof fallback === 'function' ? fallback : (() => {});
}

// --- Exports ---

// Allow the viewer to push scene into the shim (and mirror onto window.lm.scene)
export function __set_lm_scene(scene) {
  _scene = scene || null;
  _lm().scene = _scene;
}

// Return current scene (prefer window.lm.getScene if available)
export function getScene() {
  const g = _lm();
  if (typeof g.getScene === 'function') return g.getScene();
  return _scene;
}

// Ensure viewer bootstrap (delegates if available)
export const ensureViewer = (...args) => _delegate('ensureViewer')(...args);

// Load GLB from Drive (delegates)
export const loadGlbFromDrive = (...args) => _delegate('loadGlbFromDrive')(...args);

// Pin operations (delegates with safe fallbacks)
export const addPinMarker = (...args) => _delegate('addPinMarker')(...args);
export const removePinMarker = (...args) => _delegate('removePinMarker')(...args);
export const clearPins = (...args) => _delegate('clearPins')(...args);

// Selection / interactions
export const onCanvasShiftPick = (...args) => _delegate('onCanvasShiftPick')(...args);
export const onPinSelect = (...args) => _delegate('onPinSelect')(...args);
export const onRenderTick = (...args) => _delegate('onRenderTick')(...args);

// NEW: setPinSelected (requested by boot.esm.cdn.js)
export const setPinSelected = (...args) => _delegate('setPinSelected')(...args);

// Geometry helpers
export const projectPoint = (...args) => _delegate('projectPoint')(...args);

// Log available symbols once (useful for debugging)
(() => {
  try {
    const exported = [
      '__set_lm_scene',
      'getScene',
      'ensureViewer',
      'loadGlbFromDrive',
      'addPinMarker',
      'removePinMarker',
      'clearPins',
      'onCanvasShiftPick',
      'onPinSelect',
      'onRenderTick',
      'setPinSelected',
      'projectPoint',
    ];
    _log('shim loaded with exports:', exported);
  } catch (e) {
    console.warn('[viewer-shim] init log failed', e);
  }
})();
