/*! material.orchestrator.js v3.1 (UI↔Scene wiring, durable) */
(function(){
  const TAG='[mat-orch v3.1]';
  if (window.__LM_ORCH_READY) { console.debug(TAG,'already ready'); return; }

  function q(){ return window.__LM_MAT_UI && window.__LM_MAT_UI.__ready ? window.__LM_MAT_UI : null; }
  function getScene(){ return window.__LM_SCENE || null; }

  function ensureMatProps(mat, opacity){
    // Half‑transparent friendly settings
    mat.transparent = true;
    mat.opacity = opacity;
    if (opacity >= 0.999) {
      mat.depthWrite = true;
      mat.alphaTest = 0;
    } else {
      mat.depthWrite = false;
      mat.alphaTest = 0.01;
    }
    mat.needsUpdate = true;
  }

  function applyOpacityForName(name, opacity){
    const scene = getScene(); if (!scene || !name) return;
    scene.traverse(obj=>{
      const mats = obj && obj.material ? (Array.isArray(obj.material)?obj.material:[obj.material]) : null;
      if (!mats) return;
      mats.forEach(m=>{ if (m && m.name === name) ensureMatProps(m, opacity); });
    });
    // notify sheet bridge (if present)
    try{
      window.dispatchEvent(new CustomEvent('lm:material-opacity-change', { detail: { materialKey: name, opacity } }));
    }catch(e){ /* noop */ }
  }

  function syncUIFromScene(name){
    const ui = q(); const scene = getScene();
    if (!ui || !scene || !name) return;
    let foundOp = null;
    scene.traverse(obj=>{
      const mats = obj && obj.material ? (Array.isArray(obj.material)?obj.material:[obj.material]) : null;
      if (!mats) return;
      mats.forEach(m=>{
        if (m && m.name === name && foundOp === null){
          foundOp = typeof m.opacity === 'number' ? m.opacity : 1;
        }
      });
    });
    if (foundOp === null) foundOp = 1;
    ui.range.value = String(foundOp);
    ui.out.textContent = Number(foundOp).toFixed(2);
  }

  function wire(){
    const ui = q(); if (!ui) return console.warn(TAG,'UI not ready');
    const sel = ui.select, rng = ui.range, out = ui.out;
    if (!sel || !rng || !out) return console.warn(TAG,'controls missing');

    sel.addEventListener('change', ()=>{
      syncUIFromScene(sel.value || null);
    });

    rng.addEventListener('input', ()=>{
      const op = Math.max(0, Math.min(1, parseFloat(rng.value)));
      out.textContent = (isFinite(op)?op:1).toFixed(2);
      if (sel.value) applyOpacityForName(sel.value, isFinite(op)?op:1);
    }, { passive:true });

    // If both scene and a selection exist on first wire, sync once
    if (getScene() && sel.value) syncUIFromScene(sel.value);
    console.debug(TAG,'ready');
    window.__LM_ORCH_READY = true;
  }

  function arm(){
    if (!window.__LM_MAT_UI || !window.__LM_MAT_UI.__ready){ return; }
    wire();
  }

  // Scene signal makes initial sync more reliable, but we can wire without it
  window.addEventListener('lm:scene-ready', (ev)=>{
    window.__LM_SCENE = ev.detail && ev.detail.scene || window.__LM_SCENE;
    // When scene arrives and a material already selected, reflect its value
    const ui = q();
    if (ui && ui.select && ui.select.value) syncUIFromScene(ui.select.value);
  });

  // try immediately
  arm();

  // fallback if UI arrived after this file
  let tries=40; const iv=setInterval(()=>{
    if (window.__LM_MAT_UI && window.__LM_MAT_UI.__ready){ clearInterval(iv); arm(); }
    else if(--tries<=0){ clearInterval(iv); }
  }, 250);
})();
