// viewer.module.cdn.js — shim/bridge
// Purpose: provide named exports expected by boot.esm.cdn.js without importing Three.js,
// and delegate to window.lm implementations when available. Avoids multiple THREE instances.
//
// Exports:
//  - ensureViewer(opts)
//  - getScene()
//  - __set_lm_scene(scene)   // host can call after GLTF load
//  - loadGlbFromDrive(source)
//  - addPinMarker(payload)
//  - clearPins()
//  - onCanvasShiftPick(handler)   // newly added to satisfy boot import
//
// Design: prefer window.lm.* if present; otherwise fall back to CustomEvent dispatch
// so that host can listen and perform the real work.

const LOG_PREFIX = "[viewer-bridge/shim]";

function log(...a){ try{ console.log(LOG_PREFIX, ...a); }catch(e){} }
function warn(...a){ try{ console.warn(LOG_PREFIX, ...a); }catch(e){} }

// A small helper to wait for a condition with timeout.
async function waitFor(condFn, {timeoutMs=3000, intervalMs=50, label="cond"}={}){
  const t0 = performance.now();
  while (performance.now() - t0 < timeoutMs){
    try{
      const v = condFn();
      if (v) return v;
    }catch{}
    await new Promise(r=>setTimeout(r, intervalMs));
  }
  throw new Error(`${label} timeout after ${timeoutMs}ms`);
}

// ---------------- core bridge state ----------------
if (!window.lm) window.lm = {};
if (!("__readySceneResolvers" in window.lm)){
  Object.defineProperty(window.lm, "__readySceneResolvers", {
    value: [], writable: false, enumerable: false, configurable: true
  });
}

// expose a promise any consumer can await
if (!("readyScenePromise" in window.lm)){
  window.lm.readyScenePromise = new Promise((resolve)=>{
    window.lm.__readySceneResolvers.push(resolve);
  });
}

// public: host calls this when scene becomes ready
export function __set_lm_scene(scene){
  try{
    Object.defineProperty(window, "__lm_scene", { value: scene, writable: true, configurable: true });
  }catch(_){ window.__lm_scene = scene; }
  const resolvers = (window.lm.__readySceneResolvers||[]).splice(0);
  resolvers.forEach(fn=>{ try{ fn(scene); }catch(e){ warn("resolver err", e); } });
  // fire deep-ready for any legacy listeners
  try { window.dispatchEvent(new CustomEvent("pm:scene-deep-ready", { detail:{ scene } })); } catch(_){}
  log("scene set via __set_lm_scene; resolvers=", resolvers.length);
}

export function getScene(){
  if (window.lm && typeof window.lm.getScene === "function") {
    try { return window.lm.getScene(); } catch(_){}
  }
  return window.__lm_scene || null;
}

export async function ensureViewer(opts={}){
  // Prefer host implementation if present
  if (window.lm && typeof window.lm.ensureViewer === "function") {
    log("delegating ensureViewer to window.lm.ensureViewer");
    return window.lm.ensureViewer(opts);
  }
  // Fallback: ask host via event and wait for scene
  log("ensureViewer fallback: dispatch pm:ensure-viewer and wait for scene");
  try { window.dispatchEvent(new CustomEvent("pm:ensure-viewer", { detail:{ opts } })); } catch(_){}
  await waitFor(()=>getScene(), { timeoutMs: 5000, label: "scene-ready" });
  return true;
}

export async function loadGlbFromDrive(source){
  // Delegate to host if available
  if (window.lm && typeof window.lm.loadGlbFromDrive === "function"){
    log("delegating loadGlbFromDrive to window.lm.loadGlbFromDrive");
    const scene = await window.lm.loadGlbFromDrive(source);
    return scene;
  }
  // Fallback: fire event and wait for scene change
  const before = getScene();
  try { window.dispatchEvent(new CustomEvent("pm:load-glb", { detail:{ source } })); } catch(_){}
  await waitFor(()=>{
    const s = getScene();
    return s && s !== before && s;
  }, { timeoutMs: 15000, label: "load-glb" });
  return getScene();
}

export function addPinMarker(payload){
  if (window.lm && typeof window.lm.addPinMarker === "function"){
    return window.lm.addPinMarker(payload);
  }
  try { window.dispatchEvent(new CustomEvent("pm:add-pin", { detail:{ payload } })); } catch(_){}
  return true;
}

export function clearPins(){
  if (window.lm && typeof window.lm.clearPins === "function"){
    return window.lm.clearPins();
  }
  try { window.dispatchEvent(new CustomEvent("pm:clear-pins")); } catch(_){}
  return true;
}

// NEW: exported to satisfy boot.esm.cdn.js imports.
// If a handler is provided, register; otherwise delegate to lm or no-op.
export function onCanvasShiftPick(handler){
  if (window.lm && typeof window.lm.onCanvasShiftPick === "function"){
    return window.lm.onCanvasShiftPick(handler);
  }
  // Provide a simple fallback event hookup so host can listen
  if (typeof handler === "function"){
    const cb = (e)=>handler(e.detail);
    window.addEventListener("pm:canvas-shift-pick", cb);
    // return an unsubscribe function for parity with typical APIs
    return ()=>window.removeEventListener("pm:canvas-shift-pick", cb);
  }
  return ()=>{};
}

// Optional default export (not required, but harmless)
export default {
  ensureViewer,
  getScene,
  __set_lm_scene,
  loadGlbFromDrive,
  addPinMarker,
  clearPins,
  onCanvasShiftPick,
};
