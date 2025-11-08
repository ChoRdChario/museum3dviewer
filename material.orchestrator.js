/* material.orchestrator.js v3.0
 * Purpose: Bind UI <-> Scene opacity, and broadcast changes for sheet bridge
 * Contracts:
 *  - window.__LM_MAT_UI {select,range,out}
 *  - window.__LM_SCENE is a THREE.Scene (set by viewer.bridge.module.js)
 */
(function(){
  const TAG='[mat-orch v3.0]';
  if (window.__LM_MAT_ORCH_READY){ console.log(TAG,'already ready'); return; }

  function fmt(v){ try{ return Number(v).toFixed(2); }catch(_){ return String(v); } }
  function getUI(){
    const ui = window.__LM_MAT_UI || {};
    return {
      sel: ui.select || document.getElementById('pm-material'),
      rng: ui.range  || document.getElementById('pm-opacity-range'),
      out: ui.out    || document.getElementById('pm-opacity-val'),
    };
  }

  function findMaterialsByName(scene, targetName){
    const found = [];
    if (!scene || !targetName) return found;
    const norm = String(targetName).trim();
    scene.traverse(obj => {
      if (!obj.isMesh || !obj.material) return;
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      mats.forEach(m => {
        if (!m) return;
        if ((m.name||'').trim() === norm) found.push(m);
      });
    });
    return found;
  }

  function applyOpacity(mats, value){
    mats.forEach(m => {
      try{
        m.opacity = value;
        m.transparent = true;        // keep transparent enabled for consistent blending path
        m.depthWrite = value >= 0.999;
        m.alphaTest = value < 0.99 ? 0.01 : 0;
        m.needsUpdate = true;
      }catch(e){ /* ignore per-mat errors */ }
    });
  }

  function pullOpacityFromScene(scene, targetName){
    const mats = findMaterialsByName(scene, targetName);
    if (!mats.length) return null;
    // take the first as canonical value
    const v = typeof mats[0].opacity === 'number' ? mats[0].opacity : 1.0;
    return Math.max(0, Math.min(1, v));
  }

  function syncUIToScene(){
    const scene = window.__LM_SCENE;
    const { sel, rng, out } = getUI();
    if (!sel || !rng || !out || !scene) return;
    const name = sel.value;
    if (!name) return;
    const v = pullOpacityFromScene(scene, name);
    if (v == null) return;
    rng.value = String(v);
    out.value = fmt(v);
    out.textContent = fmt(v);
  }

  function onRangeInput(){
    const scene = window.__LM_SCENE;
    const { sel, rng, out } = getUI();
    if (!sel || !rng || !scene) return;
    const name = sel.value;
    if (!name) return;
    const v = Math.max(0, Math.min(1, parseFloat(rng.value)));
    out.value = fmt(v); out.textContent = fmt(v);
    const mats = findMaterialsByName(scene, name);
    if (!mats.length) return;
    applyOpacity(mats, v);
    // Broadcast for sheet bridge to persist
    window.dispatchEvent(new CustomEvent('lm:material-opacity-change', {
      detail: { materialName: name, opacity: v }
    }));
  }

  function onSelectChange(){
    syncUIToScene();
  }

  function arm(){
    const { sel, rng } = getUI();
    if (!sel || !rng){ console.warn(TAG,'UI not ready'); return; }
    sel.addEventListener('change', onSelectChange);
    rng.addEventListener('input', onRangeInput, {passive:true});
    console.log(TAG,'armed');
    // If materials already populated and a value exists, sync immediately
    if (sel.value) syncUIToScene();
  }

  function boot(){
    arm();
    console.log(TAG,'ready');
  }

  // Boot order safeguards
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(boot, 0);
  } else {
    window.addEventListener('DOMContentLoaded', boot, { once:true });
  }
  window.addEventListener('lm:materials-populated', syncUIToScene);
  window.addEventListener('lm:scene-ready', syncUIToScene);

  window.__LM_MAT_ORCH_READY = true;
})();