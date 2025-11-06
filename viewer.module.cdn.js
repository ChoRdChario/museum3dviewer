
/*
 * viewer.module.cdn.js — Safe shim
 * Provides all exports boot.esm.cdn.js expects.
 * Delegates to window.lm.* if present; otherwise no-op or Promise rejection (but never breaks with .then).
 * VERSION_TAG: V_SHIM_2025-11-06_PromiseSafe
 */

const _w = (typeof window !== 'undefined') ? window : globalThis;
_w.lm = _w.lm || {};

let _scene = null;

function _log(...a){ try{ console.log('[viewer-shim]', ...a);}catch(_){} }
function _warn(...a){ try{ console.warn('[viewer-shim]', ...a);}catch(_){} }

function _maybePromise(x){
  // Normalize any return to a real Promise for safety with ".then"
  try{
    if (x && typeof x.then === 'function') return x;
    return Promise.resolve(x);
  }catch(e){
    return Promise.reject(e);
  }
}

function _delegate(name, ...args){
  const fn = _w.lm && typeof _w.lm[name] === 'function' ? _w.lm[name] : null;
  if (!fn){ _warn(`delegate missing: lm.${name}() — using no-op`); return undefined; }
  return fn(...args);
}

// ===== Exports =====
export function __set_lm_scene(scene){
  _scene = scene || null;
  // also surface on lm for consumers that rely on it
  _w.lm.__scene = _scene;
}

export function getScene(){
  if (_w.lm && typeof _w.lm.getScene === 'function'){
    try { return _w.lm.getScene(); } catch(_) {}
  }
  return _scene;
}

export function ensureViewer(...args){
  const res = _delegate('ensureViewer', ...args);
  return _maybePromise(res);
}

export function loadGlbFromDrive(...args){
  const res = _delegate('loadGlbFromDrive', ...args);
  if (res === undefined){
    // Return a rejecting Promise to keep caller's .then chain safe and informative
    return Promise.reject(new Error('lm.loadGlbFromDrive is not implemented (shim)'));
  }
  return _maybePromise(res);
}

export function addPinMarker(...args){
  const res = _delegate('addPinMarker', ...args);
  return res;
}

export function removePinMarker(...args){
  const res = _delegate('removePinMarker', ...args);
  return res;
}

export function clearPins(...args){
  const res = _delegate('clearPins', ...args);
  return res;
}

export function onCanvasShiftPick(...args){
  const res = _delegate('onCanvasShiftPick', ...args);
  return res;
}

export function onPinSelect(...args){
  const res = _delegate('onPinSelect', ...args);
  return res;
}

export function onRenderTick(...args){
  const res = _delegate('onRenderTick', ...args);
  return res;
}

export function setPinSelected(...args){
  const res = _delegate('setPinSelected', ...args);
  return res;
}

export function projectPoint(...args){
  const res = _delegate('projectPoint', ...args);
  return res;
}

// Diagnostics
(function(){
  const exportsList = [
    '__set_lm_scene','getScene','ensureViewer','loadGlbFromDrive',
    'addPinMarker','removePinMarker','clearPins',
    'onCanvasShiftPick','onPinSelect','onRenderTick',
    'setPinSelected','projectPoint'
  ];
  _log('shim loaded with exports:', exportsList);
})();
