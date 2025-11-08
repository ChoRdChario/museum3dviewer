/*! material.dropdown.patch.js v3.1 (scene→dropdown population, once) */
(function(){
  const TAG='[mat-dd v3.1]';
  if (window.__LM_DD_DONE) { console.debug(TAG,'already done'); return; }

  function populateFromScene(scene){
    const ui = window.__LM_MAT_UI;
    if (!ui || !ui.__ready) return console.warn(TAG,'UI not ready');
    const sel = ui.select;
    if (!sel) return;

    // Keep placeholder only
    [...sel.querySelectorAll('option')].forEach((o,i)=>{ if(i>0) o.remove(); });

    const names = new Set();
    scene.traverse(obj=>{
      const mats = obj && obj.material ? (Array.isArray(obj.material)?obj.material:[obj.material]) : null;
      if (!mats) return;
      mats.forEach(m=>{
        if (!m) return;
        if (!m.name) m.name = `Material_${m.uuid.slice(0,8)}`;
        if (names.has(m.name)) return;
        names.add(m.name);
        const opt = document.createElement('option');
        opt.value = m.name;
        opt.textContent = m.name;
        sel.appendChild(opt);
      });
    });
    console.debug(TAG,'populated', sel.options.length-1);
  }

  // Prefer custom signal, else fallback polling
  function arm(){
    if (!window.__LM_MAT_UI) return;
    if (window.__LM_SCENE) { populateFromScene(window.__LM_SCENE); window.__LM_DD_DONE=true; return; }
    let tries = 60;
    const iv = setInterval(()=>{
      if (window.__LM_SCENE) {
        clearInterval(iv);
        populateFromScene(window.__LM_SCENE);
        window.__LM_DD_DONE = true;
      } else if (--tries<=0){ clearInterval(iv); console.warn(TAG,'scene not available'); }
    }, 250);
  }

  window.addEventListener('lm:scene-ready', (ev)=>{
    window.__LM_SCENE = ev.detail && ev.detail.scene || window.__LM_SCENE;
    arm();
  }, { once:true });

  // also try immediately
  arm();
})();
