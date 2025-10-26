
// material.ui.orch.js - Step2 UI wiring for LociMyu (chroma key + per-material ops)
import * as V from './viewer.module.cdn.js';
import './viewer.bridge.module.js';

const $ = (id) => document.getElementById(id);

// Build Chroma UI next to legacy "White -> Alpha" row
function ensureChromaUI() {
  const host = document.querySelector('#tab-material') || document.body;
  const legacy = document.getElementById('mat-white2alpha');
  if (!legacy) return;

  // hide legacy check
  legacy.closest('label')?.classList?.add('hidden');
  legacy.closest('label')?.setAttribute('style', 'display:none');

  // container after legacy row
  const row = document.createElement('div');
  row.className = 'row';
  row.innerHTML = `
    <div class="col">
      <label>Chroma color</label>
      <div class="line">
        <input type="color" id="pm-ck-color" value="#ffffff" />
        <input type="text" id="pm-ck-hex" value="#ffffff" size="8" style="margin-left:8px" />
      </div>
    </div>
    <div class="col">
      <label>Tolerance</label>
      <div class="line">
        <input type="range" id="pm-ck-tol" min="0" max="0.50" step="0.01" value="0.00" />
        <span id="pm-ck-tol-val" class="mono" style="margin-left:8px">0.00</span>
      </div>
    </div>
    <div class="col">
      <label>Feather</label>
      <div class="line">
        <input type="range" id="pm-ck-feather" min="0" max="0.25" step="0.01" value="0.00" />
        <span id="pm-ck-feather-val" class="mono" style="margin-left:8px">0.00</span>
      </div>
    </div>
    <div class="col">
      <label>Shading</label>
      <div class="line">
        <label><input type="checkbox" id="pm-unlit" /> Unlit-like</label>
        <label style="margin-left:12px"><input type="checkbox" id="pm-doubleside" /> Double-sided</label>
      </div>
    </div>
  `;
  legacy.parentElement?.parentElement?.insertAdjacentElement('afterend', row);
}

function uniqueNamesFrom(arr) {
  return [...new Set(arr.filter(Boolean))];
}
function namesFromViewer() {
  try { return (V.listMaterials?.() || []).map(r => r?.name).filter(Boolean); }
  catch { return []; }
}
function namesFromScene() {
  const set = new Set();
  const scene = window.__LM_SCENE;
  scene?.traverse(o => {
    if (!o.isMesh || !o.material) return;
    (Array.isArray(o.material)?o.material:[o.material]).forEach(m=>m?.name && set.add(m.name));
  });
  return [...set];
}
function getNames() {
  const n = uniqueNamesFrom([...(namesFromViewer()), ...(namesFromScene())]);
  return n.filter(x => !/^#\d+$/.test(x));
}

function fillSelect(names) {
  const sel = $('pm-material');
  if (!sel) return false;
  const cur = sel.value;
  sel.innerHTML = '<option value="">— Select material —</option>';
  names.forEach(n => {
    const o = document.createElement('option');
    o.value = n; o.textContent = n;
    sel.appendChild(o);
  });
  if (cur && names.includes(cur)) sel.value = cur;
  return names.length > 0;
}

// Read first matching material state for UI sync
function getStateOf(name) {
  let st = null;
  const s = window.__LM_SCENE;
  s?.traverse(o=>{
    if (st) return;
    if (!o.isMesh || !o.material) return;
    (Array.isArray(o.material)?o.material:[o.material]).some(m=>{
      if ((m?.name||'')===name) {
        const U = m.userData?.__lm_uniforms;
        st = {
          opacity: Number(m.opacity ?? 1),
          doubleSided: m.side === THREE.DoubleSide,
          unlitLike: !!(U?.uLMUnlit?.value > 0.5),
          chromaColor: '#'+(U?.uLMChromaColor?.value?.getHexString?.() || 'ffffff'),
          chromaTolerance: Number(U?.uLMChromaTol?.value || 0),
          chromaFeather: Number(U?.uLMChromaFeather?.value || 0),
        };
        return true;
      }
      return false;
    });
  });
  return st || {opacity:1,doubleSided:false,unlitLike:false,chromaColor:'#ffffff',chromaTolerance:0,chromaFeather:0};
}

// Apply props via official API (fallback to LM_viewer if needed)
function applyByName(name, props) {
  if (typeof V.applyMaterialPropsByName === 'function') {
    return V.applyMaterialPropsByName(name, props);
  } else if (window.LM_viewer?.applyMaterialPropsByName) {
    return window.LM_viewer.applyMaterialPropsByName(name, props);
  }
  return 0;
}

function wire() {
  ensureChromaUI();

  const sel = $('pm-material');
  const rng = $('pm-opacity-range');
  const out = $('pm-opacity-val');

  const col = $('pm-ck-color');
  const hex = $('pm-ck-hex');
  const tol = $('pm-ck-tol'), tolv = $('pm-ck-tol-val');
  const fea = $('pm-ck-feather'), feav = $('pm-ck-feather-val');
  const unlit = $('pm-unlit'), dbl = $('pm-doubleside');

  if (!(sel && rng && out && col && hex && tol && fea && unlit && dbl)) return;

  // sync selection -> UI
  const sync = ()=>{
    const n = sel.value;
    const st = n ? getStateOf(n) : null;
    const v = st?.opacity ?? 1;
    rng.value = v;
    out.textContent = v.toFixed(2);
    if (st) {
      col.value = st.chromaColor;
      hex.value = st.chromaColor;
      tol.value = st.chromaTolerance.toFixed(2);
      fea.value = st.chromaFeather.toFixed(2);
      tolv.textContent = Number(tol.value).toFixed(2);
      feav.textContent = Number(fea.value).toFixed(2);
      unlit.checked = !!st.unlitLike;
      dbl.checked = !!st.doubleSided;
    }
  };

  // helper to emit
  const emit = ()=>{
    const n = sel.value; if (!n) return;
    const props = {
      opacity: Number(rng.value||1),
      chromaColor: String(hex.value||col.value||'#ffffff'),
      chromaTolerance: Number(tol.value||0),
      chromaFeather: Number(fea.value||0),
      unlitLike: !!unlit.checked,
      doubleSided: !!dbl.checked,
    };
    out.textContent = props.opacity.toFixed(2);
    tolv.textContent = props.chromaTolerance.toFixed(2);
    feav.textContent = props.chromaFeather.toFixed(2);
    applyByName(n, props);
  };

  // events
  sel.addEventListener('change', sync);
  rng.addEventListener('input', emit, {passive:true});
  col.addEventListener('input', (e)=>{ hex.value = col.value; emit(); }, {passive:true});
  hex.addEventListener('change', (e)=>{ 
    const v = String(hex.value||'').toLowerCase();
    if (/^#[0-9a-f]{6}$/.test(v)) { col.value = v; emit(); }
  });
  tol.addEventListener('input', emit, {passive:true});
  fea.addEventListener('input', emit, {passive:true});
  unlit.addEventListener('change', emit);
  dbl.addEventListener('change', emit);

  // initial
  sync();
}

// Bootstrap: wait until DOM + after scene-ready, then fill list once.
function start() {
  const sel = $('pm-material');
  if (!sel) return;

  let tries = 0;
  const timer = setInterval(()=>{
    tries++;
    const names = getNames();
    if (names.length && fillSelect(names)) {
      clearInterval(timer);
      wire();
    }
    if (tries >= 40) clearInterval(timer);
  }, 200);

  document.addEventListener('lm:scene-ready', ()=>{
    const names = getNames();
    if (names.length) { fillSelect(names); wire(); }
  }, { once:true });
}

document.addEventListener('DOMContentLoaded', start);
