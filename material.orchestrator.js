/* material.orchestrator.js (min-safe vA3.3) */
(() => {
  const TAG='[mat-orch:min]';
  const log=(...a)=>console.log(TAG,...a), warn=(...a)=>console.warn(TAG,...a);

  // --- DOM binding (pane-local) ---
  const pane = document.querySelector('#pane-material.pane');
  if (!pane) return warn('pane not found (#pane-material)');
  const sel = pane.querySelector('#materialSelect');
  const rng = pane.querySelector('#opacityRange');
  if (!sel || !rng) return warn('controls missing in pane');

  log('UI found', {pane, select:sel, opacity:rng, doubleSided:null, unlit:null});

  // --- state ---
  let materialKeys = [];    // ['Hull','Glass',...]
  let currentKey = null;

  // --- helpers ---
  function setOptions(keys){
    materialKeys = Array.isArray(keys) ? keys : [];
    sel.innerHTML = '';
    const opt0 = document.createElement('option');
    opt0.value=''; opt0.textContent='— Select —';
    sel.appendChild(opt0);
    for (const k of materialKeys){
      const o = document.createElement('option');
      o.value = k; o.textContent = k;
      sel.appendChild(o);
    }
    log('options populated', materialKeys);
  }

  async function fetchMaterialKeys(){
    // 1) bridge API があれば使う
    if (window.viewerBridge?.getMaterialKeys){
      try { setOptions(await window.viewerBridge.getMaterialKeys()); return; }
      catch(e){ warn('bridge.getMaterialKeys failed', e); }
    }
    // 2) 要求イベントを投げて他モジュールに任せる（任意対応）
    let resolved = false;
    const onRecv = (ev) => {
      if (resolved) return;
      const arr = ev.detail?.keys;
      if (Array.isArray(arr) && arr.length){ resolved = true; setOptions(arr); }
      window.removeEventListener('lm:material-keys', onRecv);
    };
    window.addEventListener('lm:material-keys', onRecv, {once:true});
    window.dispatchEvent(new CustomEvent('lm:req-material-keys'));
    // 3) 最後の保険：何もしない（UIは空のまま）
  }

  function applyOpacity(key, value){
    if (!key) return;
    // viewerBridge に丸投げ（既存側で material 不透明度を適用）
    if (window.viewerBridge?.setMaterialOpacity){
      try { window.viewerBridge.setMaterialOpacity(key, value); }
      catch(e){ warn('setMaterialOpacity failed', e); }
    }
  }

  // --- wire ---
  sel.addEventListener('change', () => {
    currentKey = sel.value || null;
    if (currentKey) applyOpacity(currentKey, parseFloat(rng.value||'1'));
  });
  rng.addEventListener('input', () => {
    if (currentKey) applyOpacity(currentKey, parseFloat(rng.value||'1'));
  });

  // scene-ready で材料名を投入
  function onSceneReady(){ fetchMaterialKeys(); }
  window.addEventListener('lm:scene-ready', onSceneReady);

  // すでにシーンができている場合もある
  setTimeout(fetchMaterialKeys, 0);

  log('UI bound');
})();