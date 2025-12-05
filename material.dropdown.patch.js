/* material.dropdown.patch.js v3.5.3
 * Purpose: populate the per-material dropdown once, reliably,
 * after both the scene and the canonical UI are ready.
 * Guards against double execution and DOM races.
 */
(function(){
  const TAG = '[mat-dd v3.5.3]';
  if (window.__LM_MAT_DD_VERSION__ && window.__LM_MAT_DD_VERSION__ >= '3.5.3') {
    console.log(TAG, 'already loaded');
    return;
  }
  window.__LM_MAT_DD_VERSION__ = '3.5.3';

  // Helper: find canonical select element
  function locateSelect(doc){
    return doc.getElementById('pm-material')
        || doc.querySelector('#pm-opacity select')
        || null;
  }

  // Helper: collect filtered material names from the scene
  function collectMaterialNames(scene){
    const UUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
    const AUTO = /^(?:Mesh)?(?:Basic|Lambert|Phong|Standard|Physical|Toon)Material$/i;
    const keep = new Set();
    if (!scene) return [];

    scene.traverse(o => {
      if (!o.isMesh || !o.material) return;
      const arr = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of arr) {
        const name = (m.name || '').trim();
        if (!name) continue;
        if (UUID.test(name)) continue;      // ignore UUID-only
        if (AUTO.test(name)) continue;      // ignore auto default names
        keep.add(name);
      }
    });
    return Array.from(keep).sort((a,b) => a.localeCompare(b));
  }

  // Populate once
  let populated = false;
  function populateOnce(){
    if (populated) return;
    const doc = document;
    const sel = locateSelect(doc);
    const scene = window.__LM_SCENE || window.viewer?.scene;
    if (!sel || !scene) return;

    const names = collectMaterialNames(scene);
    if (!names.length) {
      console.log(TAG, 'no material names to populate (scene ready but empty set)');
      return;
    }

    const opts = ['<option value="">-- Select material --</option>']
      .concat(names.map(n => `<option value="${n}">${n}</option>`));

    sel.innerHTML = opts.join('');
    populated = true;
    console.log(TAG, 'populated', names.length);
    window.dispatchEvent(new CustomEvent('lm:mat-dd-populated', { detail: { count: names.length, names }}));
  }

  // Robust readiness: wait for both UI and scene with retries
  function whenReady(cb){
    const start = performance.now();
    let tries = 0;
    const tick = () => {
      tries++;
      const hasUI = !!locateSelect(document);
      const scene = window.__LM_SCENE || window.viewer?.scene;
      let meshes = 0, mats = 0;
      if (scene) {
        scene.traverse(o => {
          if (!o.isMesh || !o.material) return;
          meshes++;
          mats += (Array.isArray(o.material) ? o.material : [o.material]).length;
        });
      }
      const ok = hasUI && meshes > 0 && mats > 0;
      if (ok) {
        cb();
      } else {
        const elapsed = performance.now() - start;
        if (elapsed > 5000) { // give up after 5s
          console.log(TAG, 'ready wait timeout', {hasUI, meshes, mats, tries});
          return;
        }
        const delay = Math.min(100 + tries*100, 600);
        setTimeout(tick, delay);
      }
    };
    tick();
  }

  // Event wiring: populate once after glb detected OR scene stabilized
  function arm(){
    if (arm.armed) return; arm.armed = true;
    console.log(TAG, 'armed');
    // Fast path if things are already ready
    whenReady(populateOnce);

    // Listen to our custom signals as safety nets
    window.addEventListener('lm:glb-detected', () => whenReady(populateOnce), { once: true });
    window.addEventListener('lm:scene-stabilized', () => whenReady(populateOnce), { once: true });

    // Also re-arm on sheet-context change if still not populated (rare)
    window.addEventListener('lm:sheet-context', () => { if (!populated) whenReady(populateOnce); });
  }

  // Kick
  arm();
})();