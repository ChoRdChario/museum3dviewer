// viewer.bridge.module.js
(() => {
  const NS = '[viewer-bridge]';
  const log = (...a)=>console.log(NS, ...a);

  const bridge = (window.viewerBridge = window.viewerBridge || {});

  function findSceneCandidates(){
    const arr = [];
    try{ if (typeof window.__lm_getScene === 'function'){ const s = window.__lm_getScene(); if (s) arr.push(s); } }catch(_e){}
    try{ if (window.__lm_viewer && window.__lm_viewer.scene) arr.push(window.__lm_viewer.scene); }catch(_e){}
    try{ if (window.viewer && window.viewer.scene) arr.push(window.viewer.scene); }catch(_e){}
    return arr.filter(Boolean);
  }

  function collectMaterialNamesFrom(scene){
    const out = new Set();
    if (!scene || !scene.traverse) return [];
    scene.traverse(obj => {
      const m = obj && obj.material;
      if (!m) return;
      if (Array.isArray(m)){
        m.forEach(mi => add(mi));
      } else {
        add(m);
      }
    });
    function add(mat){
      if (!mat) return;
      const nm = (mat.name && String(mat.name).trim()) || ('material.' + (mat.id ?? ''));
      out.add(nm);
    }
    return Array.from(out);
  }

  bridge.listMaterials = function(){
    const scenes = findSceneCandidates();
    for (const s of scenes){
      const arr = collectMaterialNamesFrom(s);
      if (arr.length) return arr;
    }
    return [];
  };

  function dispatch(type){
    try{
      const ev = new CustomEvent(type, { bubbles:true, composed:true });
      document.dispatchEvent(ev);
      window.dispatchEvent(ev);
    }catch(_e){}
  }

  function watchSceneReadyOnce(){
    const iv = setInterval(()=>{
      const scenes = findSceneCandidates();
      if (scenes.length){
        clearInterval(iv);
        log('lm:scene-ready dispatched (bridge)');
        dispatch('lm:scene-ready');
      }
    }, 200);
  }

  function watchModelReadyOnce(){
    const iv = setInterval(()=>{
      const ok = !!(window.__lm_modelKey || (window.__lm_viewer && window.__lm_viewer.scene) || (window.viewer && window.viewer.scene));
      if (ok){
        clearInterval(iv);
        log('lm:model-ready dispatched (bridge)');
        dispatch('lm:model-ready');
      }
    }, 300);
  }

  watchSceneReadyOnce();
  watchModelReadyOnce();
})();