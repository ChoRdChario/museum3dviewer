/* material.orchestrator.js v3.3
 * Wires UI <-> Three.js materials and keeps sheet bridge hooks intact.
 * Minor update: now reads from window.__LM_ORIGINAL_MATS if available.
 */
(function(){
  const TAG='[mat-orch v3.3]';
  console.log(TAG, 'ready');

  // UI refs
  const sel = document.getElementById('pm-material');
  const rng = document.getElementById('pm-opacity-range');
  const out = document.getElementById('pm-opacity-val');

  if(!sel || !rng || !out){ console.warn(TAG, 'controls missing'); return; }

  function getMaterialByName(name){
    if (!name) return null;
    const map = window.__LM_ORIGINAL_MATS;
    if (map && map.has(name)) return map.get(name);

    // Fallback: traverse scene
    const scene = window.__LM_SCENE || (window.viewer && window.viewer.scene);
    let found = null;
    if (scene){
      scene.traverse(obj=>{
        if(found || !obj.isMesh) return;
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const m of mats){ if (m && m.name === name){ found = m; break; } }
      });
    }
    return found;
  }

  function applyOpacity(m, value){
    if(!m) return;
    const v = Math.max(0, Math.min(1, Number(value)));
    m.opacity = v;
    m.transparent = true;
    m.depthWrite = v >= 0.999;
    m.alphaTest = v < 0.99 ? 0.001 : 0;
    m.needsUpdate = true;
  }

  function updateOut(){
    const v = Number(rng.value);
    out.textContent = v.toFixed(2);
  }

  function onChange(){
    const name = sel.value;
    const m = getMaterialByName(name);
    applyOpacity(m, rng.value);
    updateOut();

    // Notify sheet bridge (if present)
    try {
      window.dispatchEvent(new CustomEvent('lm:mat-opacity', {
        detail: { materialKey: name, opacity: Number(rng.value) }
      }));
    } catch(e){ /* no-op */ }
  }

  sel.addEventListener('change', onChange, {passive:true});
  rng.addEventListener('input', onChange, {passive:true});
  rng.addEventListener('change', onChange, {passive:true});

  // Initialize displayed value
  updateOut();

})();
