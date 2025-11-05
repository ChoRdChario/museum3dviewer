
/**
 * viewer.module.cdn.js — thin bridge/shim
 * Goal:
 *  - Provide named exports expected by boot.esm.cdn.js without importing THREE (avoid multi-instance).
 *  - Delegate to window.lm if available; otherwise, communicate via CustomEvent and wait.
 */

const log = (...a) => console.log("%c[viewer-bridge/shim]", "color:#4aa", ...a);
const warn = (...a) => console.warn("%c[viewer-bridge/shim]", "color:#d75", ...a);

function now() { return (performance && performance.now) ? performance.now() : Date.now(); }

/** Internal: get current scene if any */
function _peekScene() {
  if (window.lm && typeof window.lm.getScene === "function") {
    try {
      return window.lm.getScene();
    } catch {}
  }
  return window.__lm_scene || null;
}

/** Internal: safely register scene provider and emit ready event */
function _setScene(scene) {
  try {
    // Keep a local backing field
    window.__lm_scene = scene;
    // Lazily ensure window.lm exists
    if (!window.lm) window.lm = {};
    // If lm.getScene is missing or not a getter-only, install a safe one
    const desc = Object.getOwnPropertyDescriptor(window.lm, "getScene");
    if (!desc || (desc.writable || desc.configurable)) {
      // Either not defined, or writable -> define/overwrite safely
      Object.defineProperty(window.lm, "getScene", {
        configurable: true,
        enumerable: false,
        writable: true,
        value: () => window.__lm_scene || null,
      });
    }
    // Broadcast deep-ready for any listeners (UI populate, etc.)
    try {
      window.dispatchEvent(new CustomEvent("pm:scene-deep-ready", { detail: { scene } }));
    } catch (e) {
      // no-op
    }
    log("scene registered via shim");
  } catch (e) {
    warn("failed to set scene:", e);
  }
}

/** Exported: allow host to set scene explicitly */
export function __set_lm_scene(scene) {
  _setScene(scene);
}

/** Exported: query current scene */
export function getScene() {
  return _peekScene();
}

/** Exported: ensure a viewer exists and return a scene when ready */
export async function ensureViewer(opts = {}) {
  // Prefer host implementation if provided
  if (window.lm && typeof window.lm.ensureViewer === "function") {
    return window.lm.ensureViewer(opts);
  }

  // If we already have a scene, return it
  const existing = _peekScene();
  if (existing) return existing;

  // Kick host to create viewer
  try {
    window.dispatchEvent(new CustomEvent("pm:ensure-viewer", { detail: { opts } }));
  } catch {}

  // Wait up to timeout for scene to become available
  const timeoutMs = typeof opts.timeoutMs === "number" ? opts.timeoutMs : 5000;
  const start = now();

  return new Promise((resolve, reject) => {
    let resolved = false;

    const tryResolve = () => {
      const s = _peekScene();
      if (s && !resolved) {
        resolved = true;
        cleanup();
        resolve(s);
      }
    };

    const onDeepReady = (e) => {
      if (e && e.detail && e.detail.scene) {
        _setScene(e.detail.scene); // ensure registered
      }
      tryResolve();
    };

    const cleanup = () => {
      clearInterval(tick);
      window.removeEventListener("pm:scene-deep-ready", onDeepReady);
    };

    window.addEventListener("pm:scene-deep-ready", onDeepReady);

    const tick = setInterval(() => {
      if (now() - start > timeoutMs) {
        cleanup();
        if (!resolved) {
          warn("ensureViewer timeout");
          resolve(null);
        }
        return;
      }
      tryResolve();
    }, 50);
  });
}

/** Exported: load GLB by delegating to host or asking host via event */
export async function loadGlbFromDrive(source) {
  // Prefer host implementation
  if (window.lm && typeof window.lm.loadGlbFromDrive === "function") {
    return window.lm.loadGlbFromDrive(source);
  }

  // Ask host to load and wait for scene to refresh
  const before = _peekScene();
  try {
    window.dispatchEvent(new CustomEvent("pm:load-glb", { detail: { source } }));
  } catch {}

  // Wait until scene reference changes or becomes available
  const start = now();
  const timeoutMs = 15000;
  return new Promise((resolve) => {
    const check = setInterval(() => {
      const s = _peekScene();
      if (s && s !== before) {
        clearInterval(check);
        resolve(s);
      } else if (now() - start > timeoutMs) {
        clearInterval(check);
        warn("loadGlbFromDrive timeout (no scene change)");
        resolve(s || null);
      }
    }, 100);
  });
}

/** Exported: pin helpers -> delegate or emit events */
export function addPinMarker(payload) {
  if (window.lm && typeof window.lm.addPinMarker === "function") {
    return window.lm.addPinMarker(payload);
  }
  try {
    window.dispatchEvent(new CustomEvent("pm:add-pin", { detail: payload }));
  } catch {}
}

export function clearPins() {
  if (window.lm && typeof window.lm.clearPins === "function") {
    return window.lm.clearPins();
  }
  try {
    window.dispatchEvent(new CustomEvent("pm:clear-pins"));
  } catch {}
}

// Optional default export (not required, but harmless)
export default {
  __set_lm_scene,
  ensureViewer,
  getScene,
  loadGlbFromDrive,
  addPinMarker,
  clearPins,
};
