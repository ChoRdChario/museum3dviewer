// features/viewer_bridge.js (v1) — adapter.three.js との橋渡し
if(!window.__LMY_loadGlbBlob){
  window.__LMY_loadGlbBlob = async function(blob){
    if (window.__LMY_viewer?.loadBlob) return await window.__LMY_viewer.loadBlob(blob);
    if (window.viewer?.loadBlob) return await window.viewer.loadBlob(blob);
    if (window.loadBlob) return await window.loadBlob(blob);
    document.dispatchEvent(new CustomEvent('lmy:load-glb-blob', { detail: { blob } }));
    return true;
  };
}
