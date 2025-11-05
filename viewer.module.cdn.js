
// viewer.module.cdn.js — shim/bridge version
// Guarantees named exports expected by boot.esm.cdn.js and forwards to window.lm if available.
// If not available, it emits CustomEvents as a safe fallback so the app doesn't crash on load.
//
// Exported API:
//   - ensureViewer(opts)
//   - getScene()
//   - __set_lm_scene(scene)        // call this from the viewer when GLB finishes loading
//   - loadGlbFromDrive(source)
//   - addPinMarker(payload)
//   - clearPins()
//   - onCanvasShiftPick(handler)    // subscribe; returns unsubscribe()
//   - onPinSelect(handler)          // subscribe; returns unsubscribe()
//
// Events emitted (fallback path):
//   'pm:ensure-viewer'         detail: { opts }
//   'pm:load-glb'              detail: { source }
//   'pm:add-pin'               detail: { payload }
//   'pm:clear-pins'            detail: {}
//   'pm:scene-deep-ready'      detail: { scene }
//   'pm:canvas-shift-pick'     detail: { ... } (upstream should emit for handlers)
//   'pm:pin-select'            detail: { pinId, data }
//
const _d = (...a)=>console.debug('[viewer-bridge shim]', ...a);

function _emit(type, detail) {
  try {
    window.dispatchEvent(new CustomEvent(type, { detail }));
  } catch (e) {
    console.warn('[viewer-bridge shim] event emit failed', type, e);
  }
}

function _delegate(fnName, argsArray, fallbackEmit) {
  const lm = (typeof window !== 'undefined' && window.lm) ? window.lm : null;
  if (lm && typeof lm[fnName] === 'function') {
    return lm[fnName](...(argsArray || []));
  }
  if (fallbackEmit) fallbackEmit();
  return undefined;
}

// --- exported functions ---
export function ensureViewer(opts = {}) {
  _d('ensureViewer');
  return _delegate('ensureViewer', [opts], ()=>_emit('pm:ensure-viewer', { opts }));
}

export function getScene() {
  const lm = (typeof window !== 'undefined' && window.lm) ? window.lm : null;
  if (lm && typeof lm.getScene === 'function') return lm.getScene();
  // fallback cache
  return (typeof window !== 'undefined' && window.__pm_scene) ? window.__pm_scene : null;
}

// Called by the viewer implementation once the GLB is loaded and scene is ready.
export function __set_lm_scene(scene) {
  _d('__set_lm_scene(scene)');
  if (typeof window !== 'undefined') {
    window.__pm_scene = scene;
    // lazily provide getScene if lm is not ready
    window.lm = window.lm || {};
    if (typeof window.lm.getScene !== 'function') {
      window.lm.getScene = () => window.__pm_scene || null;
    }
    // notify listeners (UI patches, populators, etc.)
    _emit('pm:scene-deep-ready', { scene });
  }
  return scene;
}

export function loadGlbFromDrive(source) {
  _d('loadGlbFromDrive', source);
  return _delegate('loadGlbFromDrive', [source], ()=>_emit('pm:load-glb', { source }));
}

export function addPinMarker(payload) {
  _d('addPinMarker', payload);
  return _delegate('addPinMarker', [payload], ()=>_emit('pm:add-pin', { payload }));
}

export function clearPins() {
  _d('clearPins');
  return _delegate('clearPins', [], ()=>_emit('pm:clear-pins', {}));
}

// Subscribe helper that returns an unsubscribe function
function _subscribe(eventType, handler) {
  if (typeof handler !== 'function') {
    console.warn('[viewer-bridge shim] handler must be a function for', eventType);
    return () => {};
  }
  const wrapped = (ev) => {
    try { handler(ev.detail); } catch (e) { console.error(e); }
  };
  window.addEventListener(eventType, wrapped);
  return () => window.removeEventListener(eventType, wrapped);
}

export function onCanvasShiftPick(handler) {
  // Delegate if upstream provides a direct API
  const lm = (typeof window !== 'undefined' && window.lm) ? window.lm : null;
  if (lm && typeof lm.onCanvasShiftPick === 'function') return lm.onCanvasShiftPick(handler);
  // Fallback to event subscription
  return _subscribe('pm:canvas-shift-pick', handler);
}

export function onPinSelect(handler) {
  const lm = (typeof window !== 'undefined' && window.lm) ? window.lm : null;
  if (lm && typeof lm.onPinSelect === 'function') return lm.onPinSelect(handler);
  return _subscribe('pm:pin-select', handler);
}

// Default export is optional; provide noop object for compatibility if someone uses default.
const defaultExport = {
  ensureViewer,
  getScene,
  __set_lm_scene,
  loadGlbFromDrive,
  addPinMarker,
  clearPins,
  onCanvasShiftPick,
  onPinSelect,
};
export default defaultExport;
