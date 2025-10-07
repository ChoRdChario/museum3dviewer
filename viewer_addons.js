\
// viewer_addons.js — add raycastFromClientXY — 2025-10-07
import * as THREE from 'three';
export function applyViewerAddons(viewer){
  if (!viewer || !viewer.renderer || !viewer.camera) return viewer;
  if (typeof viewer.raycastFromClientXY === 'function') return viewer;
  const raycaster = new THREE.Raycaster();
  viewer.raycastFromClientXY = (evOrX, yOpt) => {
    const canvas = viewer.renderer?.domElement;
    if (!canvas || !viewer.camera) return null;
    let x, y;
    if (typeof evOrX === 'number') { x = evOrX; y = yOpt; }
    else { x = evOrX.clientX; y = evOrX.clientY; }
    const r = canvas.getBoundingClientRect();
    const ndcX = ((x - r.left) / r.width) * 2 - 1;
    const ndcY = -((y - r.top)  / r.height) * 2 + 1;
    raycaster.setFromCamera({ x: ndcX, y: ndcY }, viewer.camera);
    const root = viewer.scene || viewer.world || null;
    const children = root ? (root.children || []) : [];
    const hits = raycaster.intersectObjects(children, true);
    return hits && hits.length ? hits[0] : null;
  };
  return viewer;
}
