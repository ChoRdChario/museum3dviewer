/* lm-inline v9
 * Robust material panel anchoring & click passthrough (extracted from inline block).
 * Logs with [lm-inline v9].
 */
(() => {
  const TAG='[lm-inline v9]';
  const log=(...a)=>console.log(TAG, ...a);
  const warn=(...a)=>console.warn(TAG, ...a);
  const doc=document;
  const right = doc.querySelector('#right, aside, .right, .sidebar') || doc.body;

  function detoxClickable(target){
    if (!target) return {disabled:0,target:null};
    const r = target.getBoundingClientRect();
    const p = {x: r.left + r.width*0.5, y: r.top + Math.min(16,r.height/2)};
    const chain = doc.elementsFromPoint(p.x, p.y);
    const idx = chain.indexOf(target);
    const blockers = (idx===-1?chain:chain.slice(0,idx)).filter(e=>{
      const cs=getComputedStyle(e), pos=cs.position;
      const fixedLike = pos==='fixed'||pos==='absolute'||pos==='sticky';
      return fixedLike && cs.pointerEvents!=='none' && right.contains(e);
    });
    blockers.forEach(e=>{ e.dataset.__pe_before=getComputedStyle(e).pointerEvents; e.style.pointerEvents='none'; e.classList.add('lm-pe-none'); });
    target.style.pointerEvents='auto'; target.disabled=false;
    log('url input enabled; overlays disabled:', blockers.length);
    return {disabled:blockers.length,target};
  }
  detoxClickable(doc.getElementById('glbUrl'));
  detoxClickable(doc.getElementById('auth-signin'));
  detoxClickable(doc.getElementById('btnGlb'));

  function findMaterialTabBtn() {
    const idBtn = doc.getElementById('tab-material');
    if (idBtn) return idBtn;
    const btns = [...right.querySelectorAll('button,[role="tab"],.tab,nav button,header button')];
    return btns.find(b => (b.textContent||'').trim().toLowerCase() === 'material') || null;
  }
  const materialTabBtn = findMaterialTabBtn();
  function isMaterialActive() {
    const b = materialTabBtn;
    if (!b) return true;
    const cs = b.getAttribute('aria-selected');
    if (cs) return cs === 'true';
    return b.classList.contains('active') || b.classList.contains('selected');
  }

  function visible(el){ try{ return !!el && el.offsetParent !== null; } catch(_){ return false; } }
  const tabBar = right.querySelector('[role="tablist"], .tabs, nav, header') || right;
  const candidates = [
    right.querySelector('#panel-material, [role="tabpanel"][data-tab="material"], [data-panel="material"]'),
    ...[...right.querySelectorAll('section,.card,.panel,.group')]
      .filter(c => {
        const r=c.getBoundingClientRect?.(); if(!r) return false;
        if (tabBar && r.top < (tabBar.getBoundingClientRect?.().bottom||0)) return false;
        const t=(c.textContent||'').toLowerCase();
        return /per-?material/.test(t) || /opacity/.test(t) || /chroma key|double-?sided|unlit/.test(t);
      })
  ].filter(Boolean);
  let panel = candidates.find(visible) || candidates[0] || null;

  if (!panel && tabBar){
    panel = doc.createElement('section');
    panel.id = 'panel-material';
    panel.className = 'lm-panel-material card';
    panel.style.marginTop = '8px';
    const style = doc.createElement('style');
    style.textContent = `#panel-material{display:${isMaterialActive()?'block':'none'};}`;
    doc.head.appendChild(style);
    tabBar.insertAdjacentElement('afterend', panel);
    log('synthesized panel');
  }
  if (!panel){ warn('material panel/card not found'); return; }

  function ensureAnchors(dst){
    let sel = dst.querySelector('#materialSelect');
    if (!sel) { sel = doc.createElement('select'); sel.id='materialSelect'; sel.style.width='100%'; dst.appendChild(sel); }
    let rng = dst.querySelector('#opacityRange');
    if (!rng) { rng = doc.createElement('input'); rng.type='range'; rng.id='opacityRange'; rng.min='0'; rng.max='1'; rng.step='0.01'; rng.value='1.0'; rng.style.width='100%'; dst.appendChild(rng); }
    return {sel,rng};
  }

  const tabBtn = doc.getElementById('tab-material');
  if (tabBtn) tabBtn.querySelectorAll('#materialSelect,#opacityRange').forEach(n=>n.remove());

  const {sel, rng} = ensureAnchors(panel);
  ['materialSelect','opacityRange'].forEach(id=>{ const n=doc.getElementById(id); if(n && !panel.contains(n)) panel.appendChild(n); });

  log('material controls anchored in panel', panel);
  try { window.dispatchEvent(new Event('lm:mat-ui-ready',{bubbles:true})); } catch {}
})();