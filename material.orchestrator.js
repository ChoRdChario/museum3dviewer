
// material.orchestrator.js
// UI <-> __LM_MATERIALS__ bridge controller
(function(){
  const VER = 'V6_16h_SAFE_UI_PIPELINE.A2.5';
  const log = (...a)=>console.log('[mat-orch]', ...a);
  const warn = (...a)=>console.warn('[mat-orch]', ...a);

  // Debug helper visible to console
  window.__LM_DEBUG_DUMP = function(){
    let candidates = [];
    candidates.push(document.querySelectorAll('#materialSelect').length);
    candidates.push(document.querySelectorAll('[data-lm="materialSelect"]').length);
    candidates.push(document.querySelectorAll('.lm-material-select select').length);
    const g = window.__LM_MATERIALS__;
    const keys = g && g.keys ? g.keys() : [];
    return { vbKeys: Array.from(keys||[]), candidates: candidates, THREE: !!window.THREE };
  };

  function qsCandidates(){
    return (
      document.querySelector('#materialSelect') ||
      document.querySelector('[data-lm="materialSelect"]') ||
      (document.querySelector('.lm-material-select select'))
    );
  }
  function $opacity(){ return document.querySelector('#materialOpacity') || document.querySelector('[data-lm="materialOpacity"]') || document.querySelector('.lm-opacity input[type="range"]'); }
  function $ds(){ return document.querySelector('#doubleSided') || document.querySelector('[data-lm="doubleSided"]'); }
  function $unlit(){ return document.querySelector('#unlitLike') || document.querySelector('[data-lm="unlitLike"]'); }

  function fillSelect(keys){
    const sel = qsCandidates();
    if (!sel) return false;
    sel.innerHTML = '';
    keys.forEach(k=>{
      const opt = document.createElement('option');
      opt.value = k;
      opt.textContent = k;
      sel.appendChild(opt);
    });
    return true;
  }

  async function waitForMaterialsReady(){
    return new Promise(resolve=>{
      const g = window.__LM_MATERIALS__;
      if (g && g.ready) return resolve(true);
      const onReady = ()=>{ window.removeEventListener('lm:materials-ready', onReady); resolve(true); };
      window.addEventListener('lm:materials-ready', onReady, {once:true});
      // Also poll in case event is missed
      let tries=0;
      const iv = setInterval(()=>{
        tries++;
        if (window.__LM_MATERIALS__ && window.__LM_MATERIALS__.ready){ clearInterval(iv); resolve(true); }
        if (tries>100) { clearInterval(iv); resolve(false); }
      },100);
    });
  }

  function wireUI(){
    const sel = qsCandidates();
    const r = $opacity();
    const ds = $ds();
    const un = $unlit();
    if (!sel || !r) { warn('ui not ready yet, retry... UI elements not found (materialSelect/opacityRange)'); return false; }

    const G = window.__LM_MATERIALS__;

    const applyFromUI = ()=>{
      const key = sel.value;
      if (!key) return;
      const ok = G.apply(key, {
        opacity: Number(r.value),
        doubleSided: ds ? !!ds.checked : false,
        unlit: un ? !!un.checked : false,
      });
      if (!ok){ warn('apply failed for', key); }
    };

    sel.addEventListener('change', applyFromUI);
    r.addEventListener('input', applyFromUI);
    if (ds) ds.addEventListener('change', applyFromUI);
    if (un) un.addEventListener('change', applyFromUI);
    return true;
  }

  async function boot(){
    log(VER, 'boot');
    // UI discover
    if (!qsCandidates()) {
      // wait a bit for UI to mount
      let tries=0;
      const iv = setInterval(()=>{
        tries++;
        if (qsCandidates()){ clearInterval(iv); start(); }
        if (tries>50){ clearInterval(iv); warn('UI still not found; give up'); }
      },100);
    } else {
      start();
    }
  }

  async function start(){
    log(VER, 'ui discovered');
    // Wait for materials from bridge
    const ok = await waitForMaterialsReady();
    if (!ok){ warn('THREE/scene not ready; deferred shim'); }
    const G = window.__LM_MATERIALS__;
    const keys = (G && G.keys) ? G.keys() : [];
    fillSelect(keys || []);
    // Wire UI
    let wired = wireUI();
    if (!wired){
      // retry once more shortly
      setTimeout(()=>wireUI(), 300);
    }
    log(VER, 'wireOnce complete');
  }

  // start immediately
  boot();
})();
