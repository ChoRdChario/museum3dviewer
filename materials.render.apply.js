// materials.render.apply.js  v1.2-lite
(function(){
  const TAG = "[mat-render v1.2-lite]";
  const log = (...a)=>console.log(TAG, ...a);

  function findTargets(key){
    const scene = (window.__LM_SCENE||window.scene);
    const out = [];
    if(!scene) return out;
    scene.traverse(o=>{
      if(!o.isMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach(m=>{
        if(!m) return;
        if(m.name===key || o.name===key) out.push({mesh:o, mat:m});
      });
    });
    return out;
  }

  function applyToTargets(p){
    const key = p.key || p.materialKey || "";
    const targets = findTargets(key);
    targets.forEach(({mesh, mat})=>{
      const op = (typeof p.opacity==="number" ? p.opacity : 1);
      mat.opacity = op;
      mat.transparent = (op < 0.999) || !!(mat.userData && mat.userData.__lm_chromaEnabled);
      if(typeof p.doubleSided!=="undefined"){
        mat.side = p.doubleSided ? THREE.DoubleSide : THREE.FrontSide;
      }
      if(typeof p.unlitLike!=="undefined"){
        const un = !!p.unlitLike;
        mat.lights = !un;
        mat.toneMapped = !un;
        mat.colorWrite = true;
      }
      mat.needsUpdate = true;
    });
    log("applied", { key, hit: targets.length, opacity: p.opacity, doubleSided: p.doubleSided, unlitLike: p.unlitLike });
  }

  window.addEventListener("lm:mat-apply", (e)=>{
    const p = e.detail||{};
    applyToTargets(p);
  });
  log("wired");
})();
