// materials.ui.wire.js
// v1.1 — binds #pm-material & #pm-opacity-range to Sheets via LM_MaterialsPersist

(function(){
  const TAG='[mat-ui-wire v1.1]';
  const log=(...a)=>console.log(TAG,...a);
  const warn=(...a)=>console.warn(TAG,...a);

  function $(sel){ return document.querySelector(sel); }

  function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }

  async function ensureReady(){
    // Wait a frame to allow persist script to attach
    for (let i=0;i<30;i++){
      if (window.LM_MaterialsPersist) return true;
      await wait(100);
    }
    throw new Error('LM_MaterialsPersist not ready');
  }

  function bindUI(){
    const sel = $('#pm-material');
    const rng = $('#pm-opacity-range');
    const out = $('#pm-opacity-val');

    if (!sel || !rng) { warn('UI not found', {sel:!!sel, rng:!!rng}); return; }

    // show live value
    const show = () => { if (out) out.value = Number(rng.value).toFixed(2); };
    rng.addEventListener('input', show, {passive:true});
    show();

    let t;
    const handler = async () => {
      const key = sel.value || sel.selectedOptions?.[0]?.value || '';
      if (!key) return;
      try {
        await window.LM_MaterialsPersist.upsert({
          materialKey: key,
          opacity: parseFloat(rng.value)
        });
      } catch(e) {
        warn('persist failed', e);
      }
    };
    const debounced = () => { clearTimeout(t); t = setTimeout(handler, 150); };

    rng.addEventListener('input', debounced, {passive:true});
    rng.addEventListener('change', debounced, {passive:true});
    rng.addEventListener('pointerup', debounced, {passive:true});
    sel.addEventListener('change', handler, {passive:true});

    log('wired');
  }

  (async () => {
    try {
      await ensureReady();
      bindUI();
    } catch(e){
      warn('init failed', e);
    }
  })();
})();
