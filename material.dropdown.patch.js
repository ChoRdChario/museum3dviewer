
// material.dropdown.patch.js v3.2
// Populate #pm-material from scene once it stabilizes (idempotent)
(function(){
  const TAG='[mat-dd v3.2]';
  const seen = new Set();

  function populate(){
    const sel = document.getElementById('pm-material');
    const scene = window.__LM_SCENE;
    if(!sel || !scene) return;

    const names = new Set();
    scene.traverse(o=>{
      if(!o.isMesh || !o.material) return;
      const mats = Array.isArray(o.material)? o.material : [o.material];
      mats.forEach(m=>{
        const name = m.name && String(m.name).trim() || m.uuid;
        names.add(name);
      });
    });

    // idempotent: only add missing
    const existing = new Set(Array.from(sel.options).map(o=>o.value));
    names.forEach(n=>{
      if(existing.has(n)) return;
      const opt = document.createElement('option');
      opt.value = n;
      opt.textContent = n;
      sel.appendChild(opt);
    });

    console.log(TAG, 'populated', sel.options.length);
  }

  // hooks
  window.addEventListener('lm:scene-ready', populate);
  window.addEventListener('lm:glb-detected', populate);
  // also attempt after load
  window.addEventListener('load', ()=> setTimeout(populate, 0), {once:true});
})();
