// === viewer.bridge.module.js (ROBUST) ========================================
(function(){
  const NS = '[viewer-bridge]';
  const log  = (...a)=>console.log(NS, ...a);
  const warn = (...a)=>console.warn(NS, ...a);

  const st = { scene:null, armed:false };

  function findSceneNow(){
    try{
      if (typeof window.__lm_getScene === 'function') {
        const s = window.__lm_getScene();
        if (s && s.isScene) return s;
      }
      const cands = [
        window.__lm_viewer && window.__lm_viewer.scene,
        window.viewer && window.viewer.scene,
        window.viewer3d && window.viewer3d.scene,
      ].filter(Boolean);
      for (const s of cands) if (s && s.isScene) return s;
    }catch(_) {}
    return null;
  }

  function dispatchSceneReady(){
    try{
      const ev = new CustomEvent('lm:scene-ready', { detail:{ scene:true } });
      window.dispatchEvent(ev);
      document.dispatchEvent(ev);
    }catch(_) {}
  }

  function armSceneWatcher(){
    if (st.armed) return;
    st.armed = true;

    const mark = (s)=>{
      if (s && s.isScene){ st.scene = s; log('scene captured via poll'); dispatchSceneReady(); }
    };

    window.addEventListener('lm:scene-ready', ()=>{ const s=findSceneNow(); if (s) mark(s); });
    document.addEventListener('lm:scene-ready', ()=>{ const s=findSceneNow(); if (s) mark(s); });

    let ticks=0;
    const t = setInterval(()=>{
      ticks++;
      const s = findSceneNow();
      if (s){ mark(s); clearInterval(t); }
      if (ticks>50){ clearInterval(t); warn('scene not found during bridge watch (non-fatal)'); }
    }, 200);
  }

  function listMaterials(){
    const s = st.scene || findSceneNow();
    if (!s || !window.THREE) return [];

    const badType = (m)=>{
      const t = (m && m.type) || '';
      return /Depth|Distance|Shadow|Sprite|Shader/.test(t) ||
             (m && (m.isLineBasicMaterial || m.isLineDashedMaterial || m.isPointsMaterial));
    };
    const isOverlayObj = (o)=> !!(o && (o.type==='Sprite' || (o.name||'').startsWith('__LM_') || (o.userData && o.userData.__lmOverlay)));

    const set = new Set();
    s.traverse((obj)=>{
      if (isOverlayObj(obj)) return;
      const mat = obj && obj.material;
      const push = (m)=>{
        if (!m || badType(m)) return;
        const n = (m.name||'').trim();
        if (!n || /^material\.[0-9]+$/.test(n)) return;
        set.add(n);
      };
      if (!mat) return;
      if (Array.isArray(mat)) mat.forEach(push); else push(mat);
    });
    return Array.from(set);
  }

  window.viewerBridge = window.viewerBridge || {};
  window.viewerBridge.getScene      = ()=> st.scene || findSceneNow();
  window.viewerBridge.listMaterials = ()=> listMaterials();

  armSceneWatcher();
  log('bridge installed');
})();