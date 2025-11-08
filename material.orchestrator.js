
// material.orchestrator.js v3.2
// Wires UI (range/select) to scene materials and emits persist signals.
(function(){
  const TAG='[mat-orch v3.2]';
  let currentKey = null;
  let sheetCtx = null; // {spreadsheetId, sheetGid}

  function $(id){ return document.getElementById(id); }

  // listen sheet context for later save signals
  window.addEventListener('lm:sheet-context', (e)=>{
    sheetCtx = e?.detail || null;
  });

  // helper to visit materials by key
  function visitMaterialsByKey(key, fn){
    const scene = window.__LM_SCENE;
    if(!scene || !key) return 0;
    let count = 0;
    scene.traverse(o=>{
      if(!o.isMesh || !o.material) return;
      const mats = Array.isArray(o.material)? o.material : [o.material];
      mats.forEach(m=>{
        const name = m.name && String(m.name).trim() || m.uuid;
        if(name === key){
          count++;
          fn(m, o);
        }
      });
    });
    return count;
  }

  // ensure UI reflects actual material value
  function syncUIFromScene(key){
    const rng = $('pm-opacity-range');
    const out = $('pm-opacity-val');
    if(!rng || !out) return;

    let val = 1.0;
    let found = false;
    visitMaterialsByKey(key, (m)=>{
      val = (typeof m.opacity==='number') ? m.opacity : 1.0;
      found = true;
    });
    if(found){
      rng.value = String(val);
      out.value = Number(val).toFixed(2);
    }
  }

  // live apply
  window.addEventListener('lm:pm-opacity-input', (e)=>{
    const v = Math.min(1, Math.max(0, Number(e.detail?.value ?? 1)));
    if(currentKey){
      visitMaterialsByKey(currentKey, (m)=>{
        m.opacity = v;
        m.transparent = true;
        m.depthWrite = v >= 0.999;
        m.needsUpdate = true;
      });
    }
  });

  // commit + persist signal
  window.addEventListener('lm:pm-opacity-change', (e)=>{
    const v = Math.min(1, Math.max(0, Number(e.detail?.value ?? 1)));
    if(currentKey){
      // fire a generic upsert event that a bridge can persist
      window.dispatchEvent(new CustomEvent('lm:materials-upsert', {
        detail: {
          key: currentKey,
          changes: { opacity: v },
          sheetContext: sheetCtx,
          updatedAt: new Date().toISOString()
        }
      }));
    }
  });

  window.addEventListener('lm:pm-material-selected', (e)=>{
    currentKey = e?.detail?.key || null;
    if(currentKey) syncUIFromScene(currentKey);
  });

  console.log(TAG, 'ready');
})();
