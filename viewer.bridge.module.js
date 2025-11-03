
/**
 * viewer.bridge.module.js
 * Resilient bridge that discovers a THREE.Scene and exposes material helpers.
 */
(() => {
  const LOG_PREFIX = '[viewer-bridge]';
  const STATE = {
    scene: null,
    tried: 0,
    maxTries: 600, // ~60s
    intervalMs: 100,
    materialsReady: false,
  };

  const log = (...args) => console.log(LOG_PREFIX, ...args);
  const warn = (...args) => console.warn(LOG_PREFIX, ...args);

  function getThree() {
    if (window.THREE) return window.THREE;
    try { if (globalThis.THREE) return globalThis.THREE; } catch {}
    return null;
  }

  function findSceneCandidates() {
    const cand = [];
    if (window.__lm && window.__lm.scene) cand.push(window.__lm.scene);
    if (window.lmScene) cand.push(window.lmScene);
    if (window.__LOCIMYU_SCENE__) cand.push(window.__LOCIMYU_SCENE__);
    if (window.__THREE_SCENES__ && Array.isArray(window.__THREE_SCENES__)) {
      cand.push(...window.__THREE_SCENES__);
    }
    try {
      const canvases = Array.from(document.querySelectorAll('canvas'));
      canvases.forEach((cv) => {
        if (cv.__webglrenderer && cv.__webglrenderer.scene) {
          cand.push(cv.__webglrenderer.scene);
        }
      });
    } catch {}
    return cand.filter(Boolean);
  }

  function isScene(obj, THREE) {
    try { return !!THREE && obj && (obj.isScene || obj.type === 'Scene'); } catch { return false; }
  }

  function collectMaterialMap(scene) {
    const map = new Map();
    scene.traverse((obj) => {
      if (obj.material) {
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach((m) => {
          const key = (m.name && String(m.name)) || (m.uuid && String(m.uuid)) || 'material';
          if (!map.has(key)) map.set(key, m);
        });
      }
    });
    return map;
  }

  function publishMaterials(scene, THREE) {
    const mm = collectMaterialMap(scene);
    const keys = Array.from(mm.keys());
    const api = {
      keys: () => keys.slice(),
      apply: (opts) => {
        if (!opts || !opts.key) return false;
        const mat = mm.get(opts.key);
        if (!mat) return false;
        if (typeof opts.opacity === 'number') {
          mat.transparent = opts.opacity < 0.999;
          mat.opacity = Math.min(1, Math.max(0, opts.opacity));
        }
        if (typeof opts.doubleSided === 'boolean') {
          mat.side = opts.doubleSided ? THREE.DoubleSide : THREE.FrontSide;
        }
        if (typeof opts.unlitLike === 'boolean') {
          if (opts.unlitLike && !mat.___lm_backup) {
            const back = mat.clone();
            back.name = mat.name || 'lit-backup';
            mat.___lm_backup = back;
            // simulate unlit by reducing metalness/roughness influence if present
            if ('metalness' in mat) mat.metalness = 0;
            if ('roughness' in mat) mat.roughness = 1;
            if ('envMapIntensity' in mat) mat.envMapIntensity = 0;
          } else if (!opts.unlitLike && mat.___lm_backup) {
            const back = mat.___lm_backup;
            Object.assign(mat, back);
            delete mat.___lm_backup;
          }
        }
        if ('needsUpdate' in mat) mat.needsUpdate = true;
        return true;
      },
    };
    window.__LM_MATERIALS__ = api;
    if (!STATE.materialsReady) {
      STATE.materialsReady = true;
      window.dispatchEvent(new CustomEvent('lm:materials-ready', { detail: { count: keys.length } }));
    }
    log('materials ready', keys.length);
  }

  function tryBind() {
    const THREE = getThree();
    const candidates = findSceneCandidates();
    for (const c of candidates) {
      if (isScene(c, THREE)) {
        STATE.scene = c;
        break;
      }
    }
    if (STATE.scene && THREE) {
      publishMaterials(STATE.scene, THREE);
      return true;
    }
    return false;
  }

  function startPolling() {
    const tid = setInterval(() => {
      if (tryBind()) {
        clearInterval(tid);
      } else {
        STATE.tried++;
        if (STATE.tried % 20 === 0) warn('still waiting for scene/THREE...', { tried: STATE.tried });
        if (STATE.tried > STATE.maxTries) { clearInterval(tid); warn('gave up waiting for scene'); }
      }
    }, STATE.intervalMs);
  }

  window.addEventListener('lm:scene-ready', () => {
    log('lm:scene-ready');
    setTimeout(() => { tryBind(); }, 50);
  });

  log('bridge loaded');
  if (!tryBind()) startPolling();

  window.__LM_BRIDGE_DEBUG__ = () => {
    const THREE = getThree();
    return { hasTHREE: !!THREE, scene: !!STATE.scene, tried: STATE.tried, keys: (window.__LM_MATERIALS__?.keys()||[]) };
  };
})();
