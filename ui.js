// ui.js — exports setupUI(app). Safe, idempotent wiring.
/**
 * Expected DOM:
 *  - select#selMaterial (options like "(All)", "0: name", "1: name"...)
 *  - input[type=range]#slHue/#slSat/#slLight/#slOpacity/#slWhiteKey
 *  - button#btnUnlit, button#btnDoubleSide
 *  - input[type=checkbox]#chkWhiteKey (optional)
 */
function parseMatIndex(sel){
  if (!sel) return null;
  const v = sel.value || sel.options?.[sel.selectedIndex]?.value || "";
  if (v === "(All)" || v === "" || v == null) return null;
  const num = parseInt(String(v).split(":")[0], 10);
  return Number.isFinite(num) ? num : null;
}

function bindRange(el, handler){
  if (!el) return;
  const fn = ()=>handler(parseFloat(el.value));
  el.addEventListener('input', fn);
  el.addEventListener('change', fn);
}

function ensureMatOptions(app){
  const sel = document.getElementById('selMaterial');
  if (!sel || !app?.viewer?.getMaterials) return;
  const mats = app.viewer.getMaterials?.() || [];
  const current = sel.value;
  sel.innerHTML = "";
  const optAll = document.createElement('option');
  optAll.textContent = '(All)'; optAll.value = '(All)';
  sel.appendChild(optAll);
  mats.forEach((m,i)=>{
    const opt = document.createElement('option');
    opt.value = `${i}: ${m.name||('mat.'+i)}`;
    opt.textContent = opt.value;
    sel.appendChild(opt);
  });
  // try keep previous selection
  [...sel.options].some((o)=> (o.value===current && (sel.value=current,true)));
}

export function setupUI(app){
  // guard
  if (!app || !app.viewer) return;

  // refresh material list now & on model load
  ensureMatOptions(app);
  window.addEventListener('lmy:model-loaded', ()=> ensureMatOptions(app));

  const getIndex = ()=> parseMatIndex(document.getElementById('selMaterial'));

  // HSL
  bindRange(document.getElementById('slHue'),  v => app.viewer.setHSL?.(v,   parseFloat(document.getElementById('slSat')?.value||0), parseFloat(document.getElementById('slLight')?.value||50), getIndex()));
  bindRange(document.getElementById('slSat'),  _ => app.viewer.setHSL?.(parseFloat(document.getElementById('slHue')?.value||0),  parseFloat(document.getElementById('slSat')?.value||0), parseFloat(document.getElementById('slLight')?.value||50), getIndex()));
  bindRange(document.getElementById('slLight'),_ => app.viewer.setHSL?.(parseFloat(document.getElementById('slHue')?.value||0),  parseFloat(document.getElementById('slSat')?.value||0), parseFloat(document.getElementById('slLight')?.value||50), getIndex()));

  // Opacity
  bindRange(document.getElementById('slOpacity'), v => app.viewer.setOpacity?.(Math.max(0, Math.min(1, v)), getIndex()));

  // Unlit
  const btnUnlit = document.getElementById('btnUnlit');
  if (btnUnlit){
    btnUnlit.addEventListener('click', ()=>{
      const isOn = btnUnlit.getAttribute('data-on') === '1';
      const next = !isOn;
      app.viewer.setUnlit?.(next, getIndex());
      btnUnlit.setAttribute('data-on', next ? '1':'0');
      btnUnlit.textContent = next ? 'Unlit: on' : 'Unlit: off';
    });
  }

  // DoubleSide
  const btnDS = document.getElementById('btnDoubleSide');
  if (btnDS){
    btnDS.addEventListener('click', ()=>{
      const isOn = btnDS.getAttribute('data-on') === '1';
      const next = !isOn;
      app.viewer.setDoubleSide?.(next, getIndex());
      btnDS.setAttribute('data-on', next ? '1':'0');
      btnDS.textContent = next ? 'DoubleSide: on' : 'DoubleSide: off';
    });
  }

  // White→α
  const slWhite = document.getElementById('slWhiteKey');
  const chkWhite = document.getElementById('chkWhiteKey'); // optional
  if (slWhite){
    const apply = ()=>{
      const t = Math.max(0, Math.min(1, parseFloat(slWhite.value)/100));
      app.viewer.setWhiteKey?.(t, getIndex());
      if (chkWhite && !chkWhite.checked){
        chkWhite.checked = true;
        app.viewer.setWhiteKeyEnabled?.(true, getIndex());
      } else if (!chkWhite){
        // スライダーが動いた時は有効化
        app.viewer.setWhiteKeyEnabled?.(true, getIndex());
      }
    };
    slWhite.addEventListener('input', apply);
    slWhite.addEventListener('change', apply);
  }
  if (chkWhite){
    chkWhite.addEventListener('change', ()=> app.viewer.setWhiteKeyEnabled?.(!!chkWhite.checked, getIndex()));
  }
}

// === 最低限のフォールバック（既存HTMLだけで動かす用） ===
(function bootstrapWhiteSlider(){
  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', ()=>{
      if (window.app && window.app.viewer) setupUI(window.app);
    });
  }else{
    if (window.app && window.app.viewer) setupUI(window.app);
  }
  window.addEventListener('lmy:model-loaded', ()=>{
    if (window.app && window.app.viewer) setupUI(window.app);
  });
})();
