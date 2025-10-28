// material.ui.orch.js
// Minimal UI glue: fills material list when model is ready, wires sliders.
console.log('[lm-orch] loaded');

const $ = (id) => document.getElementById(id);
const fmt = (v)=> (Number(v).toFixed(2));

function listNamesFromScene(){
  const s = window.__LM_SCENE, set = new Set();
  s?.traverse(o=>{
    if(!o.isMesh || !o.material) return;
    (Array.isArray(o.material)?o.material:[o.material]).forEach(m=>m?.name && set.add(m.name));
  });
  // drop pseudo '#0' etc.
  return [...set].filter(n => !/^#\d+$/.test(n));
}

function applyOpacityByName(name, v){
  let count = 0;
  window.__LM_SCENE?.traverse(o=>{
    if(!o.isMesh || !o.material) return;
    (Array.isArray(o.material)?o.material:[o.material]).forEach(m=>{
      if((m?.name||'') === name){
        m.transparent = v < 1;
        m.opacity = v;
        m.depthWrite = v >= 1;
        m.needsUpdate = true;
        count++;
      }
    });
  });
  return count;
}

// Fill select with names
function fillMaterialSelect(){
  const sel = $('pm-material');
  if(!sel) return;
  const cur = sel.value;
  const names = listNamesFromScene();
  sel.innerHTML = '<option value=\"\">— Select material —</option>';
  names.forEach(n=>{
    const o = document.createElement('option');
    o.value = n; o.textContent = n; sel.appendChild(o);
  });
  if(cur && names.includes(cur)) sel.value = cur;
  console.log('[lm-orch] filled', names.length, names);
}

// Wire events (idempotent)
function wire(){
  const sel = $('pm-material');
  const pr = $('pm-opacity-range');
  const pv = $('pm-opacity-val');
  if(!sel || !pr || !pv) return;

  sel.addEventListener('change', ()=>{
    // sync slider to current material opacity (first match)
    let val = 1;
    const name = sel.value;
    if(name){
      let got = null;
      window.__LM_SCENE?.traverse(o=>{
        if(got !== null) return;
        if(!o.isMesh || !o.material) return;
        (Array.isArray(o.material)?o.material:[o.material]).some(m=>{
          if((m?.name||'') === name){ got = Number(m.opacity ?? 1); return true; }
          return false;
        });
      });
      if(got != null) val = Math.max(0, Math.min(1, got));
    }
    pr.value = val;
    pv.textContent = fmt(val);
  }, { once:false });

  pr.addEventListener('input', ()=>{
    const name = sel.value;
    const v = Number(pr.value || 1);
    pv.textContent = fmt(v);
    if(name) applyOpacityByName(name, v);
  }, { passive:true });
  pv.textContent = fmt(pr.value || 1);

  // Global opacity
  const gr = $('opacity-range');
  const gv = $('opacity-val');
  if(gr && gv){
    const applyGlobal = ()=>{
      const v = Number(gr.value || 1);
      gv.textContent = fmt(v);
      window.__LM_SCENE?.traverse(o=>{
        if(!o.isMesh || !o.material) return;
        (Array.isArray(o.material)?o.material:[o.material]).forEach(m=>{
          m.opacity = v; m.transparent = v < 1; m.depthWrite = v >= 1; m.needsUpdate = true;
        });
      });
    };
    gr.addEventListener('input', applyGlobal, { passive:true });
    gv.textContent = fmt(gr.value || 1);
  }

  // Chroma controls are placeholders for Step2+ actual shader route.
  const ckEn = $('ck-enabled');
  const ckColor = $('ck-color');
  const ckTol = $('ck-tolerance');
  const ckTolVal = $('ck-tolerance-val');
  const ckFea = $('ck-feather');
  const ckFeaVal = $('ck-feather-val');

  const syncCk = ()=>{
    ckTolVal.textContent = fmt(ckTol.value || 0);
    ckFeaVal.textContent = fmt(ckFea.value || 0);
  };
  ckTol?.addEventListener('input', syncCk, { passive:true });
  ckFea?.addEventListener('input', syncCk, { passive:true });
  ckColor?.addEventListener('input', ()=>{}, { passive:true });
  ckEn?.addEventListener('change', ()=>{}, { passive:true });
  syncCk();
}

// When the scene/model becomes ready, fill once.
function onModelReady(){
  fillMaterialSelect();
  wire();
}

document.addEventListener('lm:model-ready', onModelReady, { once:true });
document.addEventListener('lm:scene-ready', ()=>{
  console.log('[lm-orch] scene-ready');
}, { once:true });
console.log('[lm-orch] scene-ready hook installed');
