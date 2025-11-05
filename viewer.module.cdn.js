
// viewer.module.cdn.js - shim to provide named exports expected by boot.esm.cdn.js
// Ensures a single THREE instance via importmap alias 'three'
import * as THREE from 'three';

// Keep a stable namespace for cross-module cooperation
const lm = (window.lm = window.lm || {});

// Local scene holder as fallback when window.lm doesn't own a getter
let __sceneRef = null;

// Small helper: delegate to window.lm[name] if available, otherwise use fallback
function _delegate(name, fallback) {
  const fn = lm && typeof lm[name] === "function" ? lm[name] : null;
  return (...args) => (fn ? fn(...args) : (fallback ? fallback(...args) : undefined));
}

// ---------- Fallback implementations (safe no-ops) ----------

// ensureViewer fallback: create a minimal renderer/scene/camera if nothing exists yet
async function _fallbackEnsureViewer() {
  try {
    if (!__sceneRef) __sceneRef = new THREE.Scene();
    // Try not to create duplicate renderers; only create if a canvas is present and no renderer known
    if (!lm.renderer) {
      const canvas = document.querySelector("#stage canvas") || document.querySelector("canvas");
      if (canvas) {
        const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
        // three r152+: outputColorSpace replaces outputEncoding
        if (renderer.outputColorSpace !== undefined) {
          renderer.outputColorSpace = THREE.SRGBColorSpace;
        }
        lm.renderer = renderer;
      }
    }
    if (!lm.camera) {
      const cam = new THREE.PerspectiveCamera(50, 1, 0.01, 1000);
      cam.position.set(0, 1, 3);
      lm.camera = cam;
    }
    return true;
  } catch (e) {
    console.warn("[viewer-shim] ensureViewer fallback failed", e);
    return false;
  }
}

async function _fallbackLoadGlbFromDrive(/* fileOrUrlOrId */) {
  console.warn("[viewer-shim] loadGlbFromDrive: delegating fallback (noop). Provide lm.loadGlbFromDrive for real loading.");
  return null;
}

function _fallbackAddPinMarker(/* pin */) {
  console.warn("[viewer-shim] addPinMarker: fallback noop");
  return null;
}

function _fallbackRemovePinMarker(/* id */) {
  console.warn("[viewer-shim] removePinMarker: fallback noop");
  return null;
}

function _fallbackClearPins() {
  console.warn("[viewer-shim] clearPins: fallback noop");
}

function _fallbackOnCanvasShiftPick(/* cb */) {
  console.warn("[viewer-shim] onCanvasShiftPick: fallback noop");
}

function _fallbackOnPinSelect(/* cb */) {
  console.warn("[viewer-shim] onPinSelect: fallback noop");
}

function _fallbackOnRenderTick(cb) {
  // very lightweight ticker to avoid spam
  let rafId = 0;
  const loop = (t) => {
    try { cb && cb(t); } catch(e){ /* swallow */ }
    rafId = window.requestAnimationFrame(loop);
  };
  rafId = window.requestAnimationFrame(loop);
  return () => window.cancelAnimationFrame(rafId);
}

// Project a 3D point or Object3D to screen space using a camera and canvas
function _fallbackProjectPoint(pointOrObject, camera, canvas) {
  try {
    const cam = camera || lm.camera;
    if (!cam) throw new Error("camera not available");
    const v = new THREE.Vector3();
    if (pointOrObject && typeof pointOrObject.x === "number") {
      v.set(pointOrObject.x, pointOrObject.y, pointOrObject.z);
    } else if (pointOrObject && pointOrObject.isObject3D && pointOrObject.matrixWorld) {
      v.set(0, 0, 0).applyMatrix4(pointOrObject.matrixWorld);
    } else {
      throw new Error("invalid point/object");
    }
    const ndc = v.clone().project(cam);
    const targetCanvas =
      canvas ||
      (lm.renderer && lm.renderer.domElement) ||
      document.querySelector("#stage canvas") ||
      document.querySelector("canvas");

    const rect = targetCanvas && targetCanvas.getBoundingClientRect
      ? targetCanvas.getBoundingClientRect()
      : { left: 0, top: 0, width: targetCanvas?.width || window.innerWidth, height: targetCanvas?.height || window.innerHeight };

    const x = (ndc.x * 0.5 + 0.5) * rect.width + rect.left;
    const y = (-ndc.y * 0.5 + 0.5) * rect.height + rect.top;
    const visible = ndc.z > -1 && ndc.z < 1;
    return { x, y, visible, ndc };
  } catch (e) {
    console.warn("[viewer-shim] projectPoint fallback failed", e);
    return { x: 0, y: 0, visible: false, ndc: new THREE.Vector3() };
  }
}

// ---------- Public API (named exports) ----------

// Allow external code to set scene explicitly (e.g., after GLTF load)
export function __set_lm_scene(scene) {
  __sceneRef = scene || null;
  lm.scene = scene || lm.scene || null;
}

// Read scene (prefer lm.getScene if provided)
export const getScene = _delegate("getScene", () => __sceneRef);

// Viewer lifecycle
export const ensureViewer = _delegate("ensureViewer", _fallbackEnsureViewer);
export const loadGlbFromDrive = _delegate("loadGlbFromDrive", _fallbackLoadGlbFromDrive);

// Pin APIs
export const addPinMarker = _delegate("addPinMarker", _fallbackAddPinMarker);
export const removePinMarker = _delegate("removePinMarker", _fallbackRemovePinMarker);
export const clearPins = _delegate("clearPins", _fallbackClearPins);

// Event hooks
export const onCanvasShiftPick = _delegate("onCanvasShiftPick", _fallbackOnCanvasShiftPick);
export const onPinSelect = _delegate("onPinSelect", _fallbackOnPinSelect);
export const onRenderTick = _delegate("onRenderTick", _fallbackOnRenderTick);

// Math / utils
export const projectPoint = _delegate("projectPoint", _fallbackProjectPoint);

// Debug banner so you can confirm the set of exports
(function(){
  const exported = [
    "__set_lm_scene",
    "getScene",
    "ensureViewer",
    "loadGlbFromDrive",
    "addPinMarker",
    "removePinMarker",
    "clearPins",
    "onCanvasShiftPick",
    "onPinSelect",
    "onRenderTick",
    "projectPoint",
  ];
  console.log("[viewer-shim] shim loaded with exports:", exported);
})();
