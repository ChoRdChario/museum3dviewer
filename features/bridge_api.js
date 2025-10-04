// features/bridge_api.js
// Small helper: call loadGlbBlob(blob, optionalName) to render via viewer_host
export function loadGlbBlob(blob, name='model.glb'){
  window.dispatchEvent(new CustomEvent('lmy:load-glb-blob', { detail: { blob, name } }));
}