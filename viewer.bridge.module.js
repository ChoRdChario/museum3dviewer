
/**
 * viewer.bridge.module.js
 * Runtime bridge that exposes THREE, Scene, Camera, Renderer and Materials to the UI layer
 * without touching your existing viewer code. Drop-in replacement.
 *
 * Strategy
 * - Import the SAME ESM 'three' module as your viewer (same specifier -> same singleton instance)
 * - Monkey-patch WebGLRenderer.render() once to capture (scene, camera) on first render
 * - Publish globals on window and dispatch:
 *      - 'lm:scene-ready'  with { scene, THREE }
 *      - 'lm:materials-ready' with { keys }
 * - Build a stable material index {list, byKey} and store at window.__LM_MATERIALS__
 */

import * as THREE from 'three';

// Make sure the app code and UI can see the same THREE
if (!('THREE' in window)) {
  // expose once
  Object.defineProperty(window, 'THREE', { value: THREE, writable: false, configurable: true });
}

const LM = (window.__lm = window.__lm || {});
LM.THREE = THREE;

// Flag to ensure we patch only once
let patched = false;
let published = false;

// Utility: once helper
function once(fn) {
  let done = false;
  return (...args) => { if (done) return; done = true; return fn(...args); };
}

// Publish globals + events
const publishScene = once((scene, camera, renderer) => {
  try {
    window.__lm = Object.assign(window.__lm || {}, { version: 'bridge.A2.6', THREE, scene, camera, renderer });
    window.__THREE_SCENES__ = [ scene ];
    // Dispatch scene-ready
    window.dispatchEvent(new CustomEvent('lm:scene-ready', { detail: { scene, THREE } }));
    // Extract and publish materials
    const mats = extractMaterials(scene);
    window.__LM_MATERIALS__ = mats;
    window.dispatchEvent(new CustomEvent('lm:materials-ready', { detail: { keys: mats.list.map(m=>m.key) } }));
    published = true;
    console.log('[viewer-bridge] published scene & materials', mats.meta);
  } catch (err) {
    console.warn('[viewer-bridge] publish failed', err);
  }
});

// Material extractor (handles ArrayMaterial)
function extractMaterials(scene) {
  const seen = new Map(); // uuid -> material
  scene.traverse(obj => {
    const m = obj.material;
    if (!m) return;
    const push = (mat)=> { if (mat && !seen.has(mat.uuid)) seen.set(mat.uuid, mat); };
    Array.isArray(m) ? m.forEach(push) : push(m);
  });

  const nameCount = Object.create(null);
  const list = [];
  for (const mat of seen.values()) {
    const base = (mat.name && String(mat.name).trim()) || '';
    let key = base || mat.uuid;
    if (base) {
      const n = (nameCount[base] = (nameCount[base] || 0) + 1);
      if (n > 1) key = `${base}#${n}`;
    }
    list.push({ key, name: base, uuid: mat.uuid, type: mat.type || 'Material' });
  }
  list.sort((a,b)=> (a.name||'').localeCompare(b.name||'') || a.key.localeCompare(b.key));

  const byKey = {};
  const byUuid = {};
  for (const item of list) {
    const mat = [...seen.values()].find(m=>m.uuid===item.uuid);
    byKey[item.key] = mat;
    byUuid[item.uuid] = mat;
  }

  return {
    list,
    byKey,
    byUuid,
    meta: { extractedAt: Date.now(), count: list.length }
  };
}

// Patch WebGLRenderer.render to intercept the first render call
function patchRenderer() {
  if (patched) return;
  const proto = THREE.WebGLRenderer && THREE.WebGLRenderer.prototype;
  if (!proto || !proto.render) {
    // three not yet fully initialized; try again on next tick
    setTimeout(patchRenderer, 50);
    return;
  }
  patched = true;
  const original = proto.render;
  proto.render = function patchedRender(scene, camera) {
    try {
      if (!published && scene && camera) {
        publishScene(scene, camera, this);
      }
    } catch (err) {
      console.warn('[viewer-bridge] intercept failed', err);
    }
    return original.apply(this, arguments);
  };
  console.log('[viewer-bridge] render() patched');
}

// In case the app already rendered before we loaded, try to find scene heuristically
function heuristicFindScene() {
  try {
    // Common stash
    if (window.__lm && window.__lm.scene && !published) {
      publishScene(window.__lm.scene, window.__lm.camera, window.__lm.renderer);
      return;
    }
    const candidates = [];
    // Look for Object3D instances added to window by apps
    for (const k of Object.keys(window)) {
      const v = window[k];
      if (v && v.isScene) candidates.push(v);
    }
    if (candidates.length && !published) {
      publishScene(candidates[0], null, null);
    }
  } catch {}
}

// Kick off
patchRenderer();
setTimeout(heuristicFindScene, 500);
setTimeout(()=>{ if (!published) patchRenderer(); }, 1000);

// For debugging from console
window.__LM_BRIDGE_DEBUG__ = function() {
  return {
    hasTHREE: !!window.THREE,
    scene: !!(window.__lm && window.__lm.scene),
    published, patched
  };
};
