
/* material.orchestrator.js
 * LociMyu - Material tab: populate #pm-material, bind opacity slider, persist to sheet
 * Depends on:
 *  - viewer.bridge.module.js (window.viewerBridge.*)
 *  - materials.sheet.bridge.js (window.materialsSheetBridge.*)
 */
(function(){
  const VERSION_TAG = 'V6_14_MAT_PERSIST';
  const log  = (...a)=>console.log('[mat-orch]', ...a);
  const warn = (...a)=>console.warn('[mat-orch]', ...a);

  function getScene(){
    try { if (window.viewerBridge?.getScene) return window.viewerBridge.getScene(); } catch(e){}
    return window.__LM_SCENE || window.__viewer?.scene || window.viewer?.scene || window.lm?.scene || null;
  }

  function listMaterials(){
    try {
      const arr = window.viewerBridge?.listMaterials?.() || [];
      if (Array.isArray(arr) && arr.length) return arr.slice();
    } catch(e){}
    // fallback: direct traverse
    const sc = getScene();
    const set = new Set();
    sc?.traverse(o=>{
      const m=o.material; if(!m) return;
      (Array.isArray(m)?m:[m]).forEach(mm=>{ if (mm?.name) set.add(mm.name); });
    });
    return Array.from(set);
  }

  function findMaterialCard(){
    const panel = document.querySelector('[data-lm="right-panel"]') || document;
    const blocks = panel.querySelectorAll('section,fieldset,div');
    for (const el of blocks) {
      const t = (el.textContent||'').toLowerCase();
      const hasRange = el.querySelector('input[type="range"]');
      if (hasRange && (t.includes('per-material opacity') || t.includes('material opacity'))) return el;
    }
    return null;
  }

  function applyOpacityByName(name, a){
    const sc = getScene(); if(!sc||!name) return false;
    let hit=0;
    sc.traverse(o=>{
      const m=o.material; if(!m) return;
      (Array.isArray(m)?m:[m]).forEach(mm=>{
        if (mm?.name===name){
          mm.transparent = a < 1 ? true : mm.transparent;
          mm.opacity = a;
          mm.needsUpdate = true;
          hit++;
        }
      });
    });
    if (hit) log(`opacity ${a.toFixed(2)} → "${name}" x${hit}`);
    return !!hit;
  }

  function populateAndBind(){
    const card = findMaterialCard() || document;
    const sel  = document.getElementById('pm-material') || card.querySelector('select');
    const sld  = card.querySelector('input[type="range"]') || document.querySelector('[data-lm="right-panel"] input[type="range"]');
    if (!sel || !sld) return false;

    // populate
    const names = listMaterials();
    if (!names.length) return false;
    sel.innerHTML = '';
    const add = (v,t)=>{ const o=document.createElement('option'); o.value=v; o.textContent=t; sel.appendChild(o); };
    add('','-- Select --'); names.forEach(n=>add(n,n));
    sel.value=''; sel.dispatchEvent(new Event('change',{bubbles:true}));

    // bind (clone replace to avoid duplicates)
    const sel2 = sel.cloneNode(true); sel2.id = sel.id; sel.parentNode.replaceChild(sel2, sel);
    const sld2 = (function(){
      const c = sld.cloneNode(true); c.id = sld.id || 'lm-material-alpha'; sld.parentNode.replaceChild(c, sld); return c;
    })();

    const onChange = () => {
      let a = parseFloat(sld2.value);
      if (isNaN(a)) a = Math.min(1, Math.max(0, (parseFloat(sld2.value)||100)/100));
      const name = sel2.value; if (!name) return;
      applyOpacityByName(name, a);
    };
    sel2.addEventListener('change', onChange);
    sld2.addEventListener('input', onChange, {passive:true});

    log('wired select & slider');
    // also install savers
    try { wireSavers(); } catch(e){ warn('wireSavers failed', e); }
    return true;
  }

  // ====== Persist to materials sheet ======
  let lastSheetCtx = null;
  window.addEventListener('lm:sheet-context', (ev)=>{ lastSheetCtx = ev?.detail || ev; log('sheet-context bound', lastSheetCtx); }, {once:false});

  function debounce(fn, ms){ let h; return (...a)=>{ clearTimeout(h); h=setTimeout(()=>fn(...a), ms); }; }
  const saveSoon = debounce(()=>saveNow('debounced'), 400);

  function getElsForSave(){
    const card = findMaterialCard() || document;
    return {
      sel:    document.getElementById('pm-material') || card.querySelector('select'),
      range:  card.querySelector('input[type="range"]') || document.querySelector('[data-lm="right-panel"] input[type="range"]'),
      chkDS:  Array.from(card.querySelectorAll('input[type="checkbox"]')).find(i => /double/i.test(i.parentElement?.textContent||'')) || null,
      chkUL:  Array.from(card.querySelectorAll('input[type="checkbox"]')).find(i => /unlit/i.test(i.parentElement?.textContent||'')) || null,
      chromaEnable: Array.from(card.querySelectorAll('input[type="checkbox"]')).find(i => /enable/i.test(i.parentElement?.textContent||'')) || null,
      chromaTol:    Array.from(card.querySelectorAll('input[type="range"]')).slice(-2)[0] || null,
      chromaFea:    Array.from(card.querySelectorAll('input[type="range"]')).slice(-1)[0] || null,
    };
  }

  async function saveNow(reason='ui'){
    try{
      if (!window.materialsSheetBridge?.upsertOne) { warn('materialsSheetBridge not ready'); return; }
      const { sel, range, chkDS, chkUL, chromaEnable, chromaTol, chromaFea } = getElsForSave();
      if (!sel) { warn('select not found'); return; }
      const name = sel.value; if (!name) return;
      let a = parseFloat(range?.value ?? '1');
      const opacity = isNaN(a) ? null : (a > 1 ? Math.min(1, Math.max(0, a/100)) : a);
      const sheetGid = (lastSheetCtx?.sheetGid != null) ? String(lastSheetCtx.sheetGid) : 'g0';
      const materialKey = `${sheetGid}:${name}`;

      const item = {
        materialKey,
        name,
        opacity,
        unlit: !!(chkUL && chkUL.checked),
        doubleSided: !!(chkDS && chkDS.checked),
        chromaColor: '',
        chromaThreshold: chromaEnable?.checked ? (parseFloat(chromaTol?.value ?? '') || null) : null,
        chromaFeather:   chromaEnable?.checked ? (parseFloat(chromaFea?.value ?? '') || null) : null,
        updatedBy: reason
      };
      await window.materialsSheetBridge.upsertOne(item);
      log('saved', item);
    }catch(e){ warn('save failed', e); }
  }

  function wireSavers(){
    const { sel, range, chkDS, chkUL, chromaEnable, chromaTol, chromaFea } = getElsForSave();
    if (!sel) return false;
    sel.addEventListener('change', ()=>saveNow('select'));
    range?.addEventListener('input', saveSoon, {passive:true});
    chkDS?.addEventListener('change', saveSoon);
    chkUL?.addEventListener('change', saveSoon);
    chromaEnable?.addEventListener('change', saveSoon);
    chromaTol?.addEventListener('input', saveSoon, {passive:true});
    chromaFea?.addEventListener('input', saveSoon, {passive:true});
    log('save bindings installed');
    return true;
  }

  // ====== bootstrap ======
  function wireOnce(){
    const ok = populateAndBind();
    return !!ok;
  }

  function start(){
    log('loaded VERSION_TAG:', VERSION_TAG);
    if (wireOnce()) return;
    window.addEventListener('lm:scene-ready', () => {
      log('scene-ready received, trying wireOnce...');
      wireOnce();
    }, { once:false });
    let tries = 0;
    const iv = setInterval(()=>{
      if (wireOnce()){ clearInterval(iv); }
      else {
        tries++;
        if (tries > 120){ clearInterval(iv); warn('gave up: no materials'); }
        else if (tries % 20 === 0){ log('still trying...', tries); }
      }
    }, 200);
  }

  start();
})();
