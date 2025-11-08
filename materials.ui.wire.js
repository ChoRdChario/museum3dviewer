// materials.ui.wire.js
// Bind Material pane controls to persistence — v1.2
const TAG = '[mat-ui-wire v1.2]';
const log = (...a)=>console.log(TAG, ...a);
const warn = (...a)=>console.warn(TAG, ...a);

function $(sel){ return document.querySelector(sel); }

function getCurrentValues(){
  const sel  = $('#pm-material');
  const rng  = $('#pm-opacity-range');
  const ds   = $('#pm-flag-doublesided');
  const un   = $('#pm-flag-unlit');
  return {
    materialKey: sel?.value || sel?.selectedOptions?.[0]?.value || '',
    opacity: rng ? parseFloat(rng.value) : 1,
    doubleSided: !!(ds && ds.checked),
    unlitLike: !!(un && un.checked),
  };
}

function setOpacityOutput(){
  const out = $('#pm-opacity-val');
  const rng = $('#pm-opacity-range');
  if (out && rng) out.textContent = Number.parseFloat(rng.value).toFixed(2);
}

async function handler(){
  try {
    if (!window.__LM_MAT_PERSIST || typeof window.__LM_MAT_PERSIST.upsert !== 'function'){
      warn('persist not ready');
      return;
    }
    const vals = getCurrentValues();
    if (!vals.materialKey) return;
    await window.__LM_MAT_PERSIST.upsert(vals);
  } catch(e){
    warn('persist failed', e);
  }
}

function wire(){
  const sel  = $('#pm-material');
  const rng  = $('#pm-opacity-range');
  const ds   = $('#pm-flag-doublesided');
  const un   = $('#pm-flag-unlit');

  if (!sel || !rng){
    warn('controls missing', {sel:!!sel, rng:!!rng});
    return;
  }
  let t;
  const debounced = () => { clearTimeout(t); t = setTimeout(handler, 120); };

  rng.addEventListener('input', ()=>{ setOpacityOutput(); debounced(); }, {passive:true});
  rng.addEventListener('change', debounced, {passive:true});
  rng.addEventListener('pointerup', debounced, {passive:true});
  sel.addEventListener('change', handler, {passive:true});
  ds  && ds.addEventListener('change', handler, {passive:true});
  un  && un.addEventListener('change', handler, {passive:true});

  setOpacityOutput();
  log('wired');
}

if (document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', wire, {once:true});
} else {
  wire();
}
