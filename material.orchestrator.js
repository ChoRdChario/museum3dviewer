// material.orchestrator.js
// Injects/uses the material <select> inside the "Per-material opacity" card and binds opacity slider.
(() => {
  const VERSION_TAG = 'V6_13b_UUID_FALLBACK';
  const log  = (...a)=>console.log('[mat-orch]', ...a);
  const warn = (...a)=>console.warn('[mat-orch]', ...a);

  log('loaded VERSION_TAG:', VERSION_TAG);

  function getPanelRoot(){
    return document.querySelector('[data-lm="right-panel"]') || document.body;
  }

  function findOpacityCard(){
    const panel = getPanelRoot();
    // Prefer a block that contains the label text and a range slider
    const blocks = panel.querySelectorAll('section,fieldset,div');
    for (const el of blocks) {
      const txt = (el.textContent || '').toLowerCase();
      const hasRange = el.querySelector('input[type="range"]');
      if (hasRange && (txt.includes('per-material opacity') || txt.includes('material opacity'))) return el;
    }
    // Fallback: first block that has a range slider
    return Array.from(blocks).find(el => el.querySelector('input[type="range"]')) || null;
  }

  function ensurePanelSelect(card){
    if (!card) return null;
    // Prefer existing #pm-material if present
    let sel = card.querySelector('#pm-material');
    if (sel) return sel;
    // Else any select in the card
    sel = card.querySelector('select');
    if (sel) return sel;
    // Else create one at the top of the card
    const row = document.createElement('div');
    row.style.cssText='display:flex;align-items:center;gap:8px;margin:6px 0 10px 0;';
    const lab = document.createElement('div');
    lab.textContent='Select material';
    lab.style.cssText='font-size:12px;opacity:.7;white-space:nowrap;';
    sel = document.createElement('select');
    sel.id = 'pm-material';
    sel.title = '-- Select material --';
    sel.style.cssText='flex:1;min-width:0;';
    row.appendChild(lab); row.appendChild(sel);
    card.prepend(row);
    return sel;
  }

  function listMaterialsSafe(){
    try {
      if (window.viewerBridge && typeof window.viewerBridge.listMaterials === 'function'){
        const arr = window.viewerBridge.listMaterials() || [];
        if (Array.isArray(arr) && arr.length) return arr.slice();
      }
    } catch(e){}
    return [];
  }

  function populateSelect(sel, names){
    if (!sel) return;
    sel.innerHTML='';
    const add=(v,t)=>{ const o=document.createElement('option'); o.value=v; o.textContent=t; sel.appendChild(o); };
    add('', '-- Select --');
    names.forEach(n=>add(n,n));
    sel.value='';
    sel.dispatchEvent(new Event('change', {bubbles:true}));
    log('populated into panel select:', names.length);
  }

  function getScene(){
    if (window.viewerBridge?.getScene) {
      try { return window.viewerBridge.getScene(); } catch(e){}
    }
    return window.__viewer?.scene || window.viewer?.scene || window.lm?.scene || null;
  }

  function applyOpacity(name, a){
    const scene = getScene(); if (!scene || !name) return false;
    let hit=0;
    scene.traverse(obj=>{
      const m=obj.material; if(!m) return;
      (Array.isArray(m)?m:[m]).forEach(mm=>{
        if (mm && mm.name === name){
          mm.transparent = a < 1 ? true : mm.transparent;
          mm.opacity = a;
          mm.needsUpdate = true;
          hit++;
        }
      });
    });
    if (hit) log(`apply opacity ${a.toFixed(2)} → "${name}" x${hit}`);
    return !!hit;
  }

  function bindSlider(sel, card){
    if (!sel || !card) return;
    const slider = card.querySelector('input[type="range"]') ||
                   getPanelRoot().querySelector('input[type="range"]');
    if (!slider) { warn('opacity slider not found'); return; }

    // Avoid duplicate listeners by cloning
    const sel2 = sel.cloneNode(true); sel2.id = sel.id;
    sel.parentNode.replaceChild(sel2, sel);
    const sld2 = slider.cloneNode(true); sld2.id = slider.id || 'lm-material-alpha';
    slider.parentNode.replaceChild(sld2, slider);

    const handler = () => {
      const name = sel2.value;
      if (!name) return;
      let a = parseFloat(sld2.value);
      if (isNaN(a)) a = Math.min(1, Math.max(0, (parseFloat(sld2.value)||100)/100));
      applyOpacity(name, a);
    };
    sel2.addEventListener('change', handler);
    sld2.addEventListener('input', handler, {passive:true});
    log('bound slider & select');
  }

  function start(){
    let tries = 0, max = 60; // ~6s
    const iv = setInterval(() => {
      const names = listMaterialsSafe();
      const card  = findOpacityCard();
      const sel   = ensurePanelSelect(card);

      if (!card || !sel) { tries++; if (tries>=max){ clearInterval(iv); warn('panel select not found'); } return; }

      if (names.length) {
        populateSelect(sel, names);
        bindSlider(sel, card);
        clearInterval(iv);
      } else {
        warn('no materials yet, retrying…');
        tries++;
        if (tries>=max){ clearInterval(iv); warn('gave up: no materials'); }
      }
    }, 100);

    // also react when the scene finally appears
    window.addEventListener('lm:scene-ready', () => {
      const names = listMaterialsSafe();
      const card  = findOpacityCard();
      const sel   = ensurePanelSelect(card);
      if (sel && names.length){
        populateSelect(sel, names);
        bindSlider(sel, card);
      }
    });
  }

  // boot
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();