// features/bridge_api.js
export function loadGlbBlob(blob, name='model.glb'){
  dispatchEvent(new CustomEvent('lmy:load-glb-blob', { detail: { blob, name } }));
}