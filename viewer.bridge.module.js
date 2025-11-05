// viewer.bridge.module.js
const log = (...a)=>console.log('[viewer-bridge+]', ...a);
const warn = (...a)=>console.warn('[viewer-bridge+]', ...a);

window.lm = window.lm || {};
let readyResolve;
window.lm.readyScenePromise = window.lm.readyScenePromise || new Promise(res => (readyResolve = res));
if (!window.lm.__resolveReadyScene) {
  window.lm.__resolveReadyScene = (scene)=>{
    try { readyResolve && readyResolve(scene); }
    catch(e){ warn('resolveReadyScene failed', e); }
  };
}

if (!window.lm.getScene) {
  Object.defineProperty(window.lm, 'getScene', {
    configurable: true,
    enumerable: true,
    get(){
      return window.__lm_scene || null;
    }
  });
}

window.addEventListener('pm:scene-deep-ready', (e)=>{
  if (typeof window.lm.__resolveReadyScene === 'function') {
    window.lm.__resolveReadyScene(e?.detail?.scene || null);
  }
});

log('getScene exposed (lazy/sniff)');
log('ready bridge installed');
