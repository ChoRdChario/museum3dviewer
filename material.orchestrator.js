// material.orchestrator.js (minimal, stable)
(() => {
  const TAG='[mat-orch:min]';
  const log=(...a)=>console.log(TAG, ...a);

  const pane = document.getElementById('pane-material');
  const sel  = pane?.querySelector('#materialSelect');
  const rng  = pane?.querySelector('#opacityRange');

  async function populate() {
    if (!sel) return;
    const api = window.viewerBridge && window.viewerBridge.getMaterialKeys;
    const keys = api ? await api() : [];
    sel.innerHTML = '';
    const opt0 = document.createElement('option');
    opt0.value=''; opt0.textContent='— Select —';
    sel.appendChild(opt0);
    keys.forEach(k=>{
      const o=document.createElement('option');
      o.value=o.textContent=k;
      sel.appendChild(o);
    });
    log('materials populated:', keys.length);
  }

  function init(){
    if (!pane || !sel || !rng) { log('UI not ready'); return; }
    log('UI bound');
    // try now (already loaded scene case)
    populate();
    // refresh on scene events if present
    window.addEventListener('lm:scene-ready', () => setTimeout(populate, 100));
    document.addEventListener('pm:scene-deep-ready', () => setTimeout(populate, 100));
  }

  init();
})();