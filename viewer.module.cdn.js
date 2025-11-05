// viewer.module.cdn.js (safe shim)
// Exports expected by boot.esm.cdn.js without importing three.js to avoid multi-instance issues.
// Provides minimal delegations into existing global viewer, if available.

// --- internal helpers ---
function _log(...a){ try{ console.log('[viewer-shim]', ...a); }catch(_){} }

// returns a Scene if obtainable
export function getScene(){
  try {
    if (globalThis.lm && typeof globalThis.lm.getScene === 'function') {
      const s = globalThis.lm.getScene();
      if (s) return s;
    }
  } catch(e){ _log('lm.getScene failed', e); }

  try {
    if (globalThis.__lm_scene) return globalThis.__lm_scene;
  } catch(e){ _log('__lm_scene access failed', e); }

  // last resort: ask host to emit
  try {
    globalThis.dispatchEvent?.(new CustomEvent('pm:request-scene'));
  } catch(_) {}
  return undefined;
}

// allow viewer code to set the scene safely without rewriting globals
export function __set_lm_scene(scene){
  try { Object.defineProperty(globalThis, '__lm_scene', { value: scene, configurable: true, writable: true }); }
  catch { globalThis.__lm_scene = scene; }
  _log('scene set via __set_lm_scene', !!scene);
}

// add a pin marker, delegating if real impl exists
export function addPinMarker(data){
  // if viewer has real implementation, delegate
  try {
    if (globalThis.lm && typeof globalThis.lm.addPinMarker === 'function') {
      return globalThis.lm.addPinMarker(data);
    }
  } catch(e){ _log('lm.addPinMarker failed', e); }

  // otherwise, fire an event for legacy handlers
  try {
    globalThis.dispatchEvent?.(new CustomEvent('pm:add-pin', { detail: data }));
  } catch(e){ _log('event pm:add-pin failed', e); }
}

// clear pins, delegating if real impl exists
export function clearPins(){
  try {
    if (globalThis.lm && typeof globalThis.lm.clearPins === 'function') {
      return globalThis.lm.clearPins();
    }
  } catch(e){ _log('lm.clearPins failed', e); }
  try {
    globalThis.dispatchEvent?.(new CustomEvent('pm:clear-pins'));
  } catch(e){ _log('event pm:clear-pins failed', e); }
}

// Optionally expose everything on a namespaced object for compatibility (no override if exists)
try {
  globalThis.viewerShim = globalThis.viewerShim || { getScene, __set_lm_scene, addPinMarker, clearPins };
} catch {}
