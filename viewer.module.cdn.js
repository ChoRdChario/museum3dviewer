// viewer.module.cdn.js — shim exports for boot.esm.cdn.js compatibility
// Ensures a stable set of named exports even if underlying viewer implementation differs.
// Uses the single three.js instance via import map alias "three".
import * as THREE from 'three';

const log = (...a)=>console.log('[viewer-shim]', ...a);

// Try to discover canvas and camera from window.lm if available
function getCanvas() {
  // common ids/selectors in this project
  const el = (window.lm && window.lm.canvas) ||
             document.querySelector('#stage canvas') ||
             document.querySelector('canvas') ||
             (window.lm && window.lm.renderer && window.lm.renderer.domElement) ||
             null;
  return el || null;
}

function getCamera() {
  if (window.lm) {
    if (typeof window.lm.getCamera === 'function') return window.lm.getCamera();
    if (window.lm.camera) return window.lm.camera;
  }
  return null;
}

// --- exported shims (delegate to window.lm/* if present) ---
// We avoid throwing; return sensible fallbacks.
export function __set_lm_scene(scene){
  if (!window.lm) window.lm = {};
  window.lm.scene = scene;
}

export function getScene(){
  if (window.lm && typeof window.lm.getScene === 'function') return window.lm.getScene();
  return window.lm && window.lm.scene ? window.lm.scene : null;
}

export async function ensureViewer(){
  if (window.lm && typeof window.lm.ensureViewer === 'function') return window.lm.ensureViewer();
  // No-op fallback
  return true;
}

export async function loadGlbFromDrive(fileId){
  if (window.lm && typeof window.lm.loadGlbFromDrive === 'function') {
    return window.lm.loadGlbFromDrive(fileId);
  }
  console.warn('[viewer-shim] loadGlbFromDrive fallback (no viewer impl)');
  return null;
}

export function addPinMarker(pin){
  if (window.lm && typeof window.lm.addPinMarker === 'function') return window.lm.addPinMarker(pin);
  // fallback: no-op
  return null;
}

export function clearPins(){
  if (window.lm && typeof window.lm.clearPins === 'function') return window.lm.clearPins();
  return 0;
}

export function onCanvasShiftPick(handler){
  if (window.lm && typeof window.lm.onCanvasShiftPick === 'function') return window.lm.onCanvasShiftPick(handler);
  // fallback wire: basic listener on canvas mousedown + shiftKey
  const cvs = getCanvas();
  if (!cvs) return ()=>{};
  const fn = (e)=>{
    if (e.shiftKey) handler && handler(e);
  };
  cvs.addEventListener('mousedown', fn);
  return ()=>cvs.removeEventListener('mousedown', fn);
}

export function onPinSelect(handler){
  if (window.lm && typeof window.lm.onPinSelect === 'function') return window.lm.onPinSelect(handler);
  // fallback: no-op unsubscribe
  return ()=>{};
}

export function onRenderTick(handler){
  if (window.lm && typeof window.lm.onRenderTick === 'function') return window.lm.onRenderTick(handler);
  // fallback: rAF loop
  let af = 0, alive = true;
  const loop = (t)=>{
    if (!alive) return;
    try { handler && handler(t); } catch(e){ console.warn('[viewer-shim] onRenderTick handler error', e); }
    af = requestAnimationFrame(loop);
  };
  af = requestAnimationFrame(loop);
  return ()=>{ alive=false; cancelAnimationFrame(af); };
}

// NEW required export
export function projectPoint(pos){
  // Delegate if provided by real viewer
  if (window.lm && typeof window.lm.projectPoint === 'function') return window.lm.projectPoint(pos);

  // Fallback: compute using active camera and canvas
  const camera = getCamera();
  const cvs = getCanvas();
  if (!camera || !cvs || !pos) {
    console.warn('[viewer-shim] projectPoint fallback missing camera/canvas/pos');
    return null;
  }

  const rect = cvs.getBoundingClientRect();
  const v = pos.isVector3 ? pos.clone() : new THREE.Vector3(pos.x||0, pos.y||0, pos.z||0);
  v.project(camera);
  const x = (v.x + 1) * 0.5 * rect.width + rect.left + window.scrollX;
  const y = (1 - (v.y + 1) * 0.5) * rect.height + rect.top + window.scrollY;
  return { x, y, inFront: v.z < 1, ndc: { x: v.x, y: v.y, z: v.z } };
}

// Dev log of available exports
try {
  const exp = ['__set_lm_scene','getScene','ensureViewer','loadGlbFromDrive','addPinMarker','clearPins','onCanvasShiftPick','onPinSelect','onRenderTick','projectPoint'];
  log('shim loaded with exports:', exp);
} catch(e){}
