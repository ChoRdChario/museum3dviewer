// materials.render.apply.js
// v1.2: Honor per-material flags and keep baseline guard compatible
(function(){
  const TAG='[mat-render v1.2]';
  function log(...a){ console.log(TAG, ...a); }

  function applyFlags({key, opacity=1, doubleSided=false, unlitLike=false}){
    const scene = window.__LM_SCENE || window.scene;
    if (!scene || !key) return {hit:0};
    let hit=0;
    scene.traverse(o=>{
      if (!o.isMesh) return;
      const arr = Array.isArray(o.material) ? o.material : [o.material];
      arr.forEach(m=>{
        if (!m) return;
        if (m.name===key || o.name===key){
          // Base: opacity
          m.opacity = (typeof opacity==='number') ? opacity : 1;
          const needsTransparent = (m.opacity ?? 1) < 0.999 || !!m.userData?.__lm_chromaEnabled;
          m.transparent = !!needsTransparent;
          // Flags
          m.side = doubleSided ? (window.THREE?.DoubleSide ?? 2) : (window.THREE?.FrontSide ?? 0);
          m.color?.convertSRGBToLinear?.();
          if (unlitLike){
            m.emissive?.set?.(m.color ? m.color : 0xffffff);
            if (typeof m.emissiveIntensity === 'number') m.emissiveIntensity = 1.0;
            if (m.map && m.map.encoding !== (window.THREE?.sRGBEncoding)){ /* keep current */ }
          } else {
            if (m.emissive) m.emissive.set(0x000000);
            if (typeof m.emissiveIntensity === 'number') m.emissiveIntensity = 0.0;
          }
          m.needsUpdate = true;
          hit++;
        }
      });
    });
    window.dispatchEvent(new Event('lm:mat-apply'));
    log('applied', {key, opacity, doubleSided, unlitLike, hit});
    return {hit};
  }

  // Wire to custom event used by the UI/persist layer
  window.addEventListener('lm:mat-apply-flags', e => {
    const d = (e && e.detail) || {};
    applyFlags(d);
  });

  log('wired');
})();
