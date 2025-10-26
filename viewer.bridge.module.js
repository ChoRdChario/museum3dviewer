
// viewer.bridge.module.js
// Bridge exports backed by window.__LM_SCENE, plus a safety scene-ready dispatcher.
let __fired = false;
function fireOnce() {
  if (__fired) return;
  if (typeof document !== 'undefined' && window.__LM_SCENE) {
    try {
      document.dispatchEvent(new CustomEvent('lm:scene-ready', { detail: { scene: window.__LM_SCENE } }));
      console.log('[viewer-bridge] lm:scene-ready dispatched (bridge)');
    } catch {}
    __fired = true;
  }
}
// observe periodically for late scene publication
const __timer = setInterval(() => {
  if (window.__LM_SCENE) { fireOnce(); clearInterval(__timer); }
}, 200);

export function listMaterials() {
  const out = [];
  const s = window.__LM_SCENE;
  if (!s) return out;
  s.traverse(o => {
    if (!o.isMesh || !o.material) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    mats.forEach((m, idx) => {
      out.push({
        name: m?.name || '',
        materialKey: m?.uuid || null,
        meshUuid: o.uuid,
        index: idx
      });
    });
  });
  return out;
}

export function listMaterialNames() {
  const arr = listMaterials();
  return [...new Set(arr.map(r => r.name).filter(n => n && !/^#\d+$/.test(n)))];
}

export function applyMaterialPropsByName(name, props = {}) {
  const s = window.__LM_SCENE;
  if (!s) return 0;
  let count = 0;
  s.traverse(o => {
    if (!o.isMesh || !o.material) return;
    (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => {
      if ((m?.name || '') === String(name)) {
        if ('opacity' in props) {
          const v = Math.max(0, Math.min(1, Number(props.opacity)));
          m.transparent = v < 1;
          m.opacity = v;
          m.depthWrite = v >= 1;
        }
        // future: doubleSided/unlit etc
        m.needsUpdate = true;
        count++;
      }
    });
  });
  return count;
}
