// viewer.module.cdn.js (shim)
// Minimal bridge: provide named exports expected by boot.esm.cdn.js
// without re-initializing Three.js or mutating window.lm. Safe to drop-in.
//
// Exports:
//   - addPinMarker(...): delegates to global handler when available, or dispatches a CustomEvent
//   - getScene(): tries bridge first, then a known global fallback

export function addPinMarker(...args) {
  // Prefer a globally provided implementation if present
  if (typeof window.addPinMarker === 'function') {
    try { return window.addPinMarker(...args); } catch (e) { console.warn('[viewer.module shim] addPinMarker global threw', e); }
  }
  // Fallback: broadcast an event others can handle
  try {
    window.dispatchEvent(new CustomEvent('lm:add-pin', { detail: { args } }));
  } catch (e) {
    console.warn('[viewer.module shim] failed to dispatch lm:add-pin', e);
  }
  return null;
}

export function getScene() {
  // Prefer bridge API
  try {
    if (window.lm && typeof window.lm.getScene === 'function') {
      return window.lm.getScene();
    }
  } catch(_) {}
  // Fallback: a global the viewer may set
  if (window.__lm_scene) return window.__lm_scene;
  // Last resort: let listeners know we tried
  try {
    window.dispatchEvent(new CustomEvent('lm:scene-request'));
  } catch(_) {}
  return null;
}

// Optional: expose a non-invasive helper for others to set a scene safely
// without overwriting getters on window.lm
if (!window.__set_lm_scene) {
  Object.defineProperty(window, '__set_lm_scene', {
    value: (scene) => { window.__lm_scene = scene; },
    writable: false, configurable: true, enumerable: false
  });
}

// Note: This file intentionally does NOT import 'three' or mutate window.lm,
// avoiding multiple Three.js instances and read-only property errors.
