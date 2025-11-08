/* material.dropdown.patch.js v3.0 (single-run)
 * Purpose: Populate #pm-material from THREE scene once scene is ready
 * Strategy: listen for 'lm:scene-ready' (from viewer.bridge) or immediate if window.__LM_SCENE exists
 */
(function(){
  const TAG='[mat-dd v3.0]';
  if (window.__LM_DD_DONE){ console.log(TAG,'already populated'); return; }

  function collectMaterials(scene){
    const names = new Set();
    scene.traverse(obj => {
      if (!obj.isMesh || !obj.material) return;
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      mats.forEach(m => {
        let name = (m && m.name) ? String(m.name) : '';
        if (!name) {
          // assign a stable generated name if missing
          name = `Material_${(m.uuid||Math.random().toString(36).slice(2)).slice(0,8)}`;
          try { m.name = name; } catch(_){}
        }
        names.add(name);
      });
    });
    return Array.from(names).sort((a,b)=>a.localeCompare(b));
  }

  function populate(){
    try{
      const ui = window.__LM_MAT_UI || {};
      const sel = (ui.select) || document.getElementById('pm-material');
      if (!sel){ console.warn(TAG,'select missing'); return; }
      const scene = window.__LM_SCENE;
      if (!scene){ console.warn(TAG,'scene missing'); return; }
      const list = collectMaterials(scene);
      // Preserve first placeholder
      const firstIsPlaceholder = sel.options.length && !sel.options[0].value;
      sel.innerHTML = firstIsPlaceholder ? sel.options[0].outerHTML : '<option value="">— Select material —</option>';
      list.forEach(name => {
        const opt = document.createElement('option');
        opt.value = name; opt.textContent = name;
        sel.appendChild(opt);
      });
      window.__LM_DD_DONE = true;
      console.log(TAG,'populated', list.length);
      window.dispatchEvent(new CustomEvent('lm:materials-populated', { detail:{ count:list.length } }));
    }catch(e){
      console.warn(TAG,'populate error', e);
    }
  }

  function tryPopulate(){
    if (window.__LM_SCENE) populate();
  }

  window.addEventListener('lm:scene-ready', populate, { once:true });
  // In some boots viewer.bridge fires earlier; try immediate populate as well
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(tryPopulate, 0);
  } else {
    window.addEventListener('DOMContentLoaded', tryPopulate, { once:true });
  }
})();