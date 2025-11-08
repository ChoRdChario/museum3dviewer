
/* material.dropdown.patch.v2.js
 * v2 — Robust material-name dropdown populate with retries
 * Safe to include AFTER bridges; independent of orchestrator
 */
(() => {
  const TAG='[mat-dd-fix v2]';
  const log=(...a)=>console.log(TAG, ...a);
  const warn=(...a)=>console.warn(TAG, ...a);

  const selQuery = '#materialSelect, #pm-material';
  let tries = 0;
  const MAX = 60; // ~15s with 250ms interval

  function getScene(){
    return window.__LM_SCENE || window.__lm_scene ||
           (window.viewer && window.viewer.scene) ||
           (window.viewerBridge && window.viewerBridge.getScene && window.viewerBridge.getScene()) ||
           null;
  }

  function collectMaterialKeys(scene){
    const keys = new Set();
    try {
      scene.traverse(o => {
        if (!o || !o.isMesh || !o.material) return;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          const name = (m && m.name ? String(m.name).trim() : '');
          if (name) keys.add(name);
        }
      });
    } catch(e){ warn('traverse failed', e); }
    return [...keys].sort();
  }

  function populateSelect(sel, keys){
    const current = sel.value;
    sel.innerHTML = '';
    const opt0 = document.createElement('option');
    opt0.value=''; opt0.textContent='— Select —';
    sel.appendChild(opt0);
    keys.forEach(k => {
      const o = document.createElement('option');
      o.value=k; o.textContent=k;
      sel.appendChild(o);
    });
    if (current && keys.includes(current)) sel.value=current;
    log('dropdown populated', { count: keys.length });
  }

  function tick(){
    const sel = document.querySelector(selQuery);
    const scene = getScene();
    const missing = { select: !sel, scene: !scene };
    if (missing.select || missing.scene){
      if (++tries <= MAX){
        if (tries % 10 === 1) warn('waiting...', missing, `(${tries}/${MAX})`);
        return; // keep retrying
      }
      return warn('abort: prerequisites missing', missing);
    }

    const keys = collectMaterialKeys(scene);
    if (keys.length === 0){
      if (++tries <= MAX){
        if (tries % 10 === 1) warn('no materials yet, retry');
        return;
      }
      return warn('abort: no materials found');
    }

    populateSelect(sel, keys);
    clearInterval(timer);
  }

  const timer = setInterval(tick, 250);
  // also retry when scene-ready signal fires
  window.addEventListener('lm:scene-ready', () => setTimeout(tick, 100));
  log('installed');
})();
