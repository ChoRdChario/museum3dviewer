/* material.orchestrator.js — drop-in replacement
 * Wires Material tab UI to actual three.js materials via window.__LM_MATERIALS__.
 * Keeps existing log style: [mat-orch] ...
 */
(function(){
  const log = (...a)=>console.log('[mat-orch]', ...a);
  const warn = (...a)=>console.warn('[mat-orch]', ...a);

  const S = {
    wired:false, ctxReady:false, keys:[],
    ui:{},
    current:{ key:null, opacity:1, doubleSided:false, unlit:false },
  };

  // ---- UI discovery with retries -----------------------------------------
  function pickUI(){
    const root = document;
    const ui = {
      materialSelect: root.querySelector('#materialSelect, [data-lm="materialSelect"], .lm-material-select select'),
      opacityRange: root.querySelector('#materialOpacity, [data-lm="materialOpacity"], .lm-material-opacity input[type="range"]'),
      doubleSided:  root.querySelector('#doubleSided, [data-lm="doubleSided"], .lm-double-sided input[type="checkbox"]'),
      unlit:        root.querySelector('#unlitLike, [data-lm="unlitLike"], .lm-unlit-like input[type="checkbox"]'),
    };
    if (!ui.materialSelect || !ui.opacityRange) {
      throw new Error('UI elements not found (materialSelect/opacityRange)');
    }
    S.ui = ui;
    log('ui discovered');
  }

  // ---- Apply to model via bridge ------------------------------------------
  function apiReady(){
    return !!(window.__LM_MATERIALS__ && window.__LM_MATERIALS__.ready && window.__LM_MATERIALS__.ready());
  }
  function applyToModel(payload){
    const api = window.__LM_MATERIALS__;
    if (!api || !api.ready || !api.ready()) {
      warn('THREE/scene not ready; deferred shim');
      setTimeout(()=>applyToModel(payload), 120);
      return;
    }
    const {key, opacity, doubleSided, unlit} = payload;
    const ok = api.apply(key, {opacity, doubleSided, unlit});
    if (!ok) warn('key not indexed:', key);
  }

  // ---- Populate materials select -----------------------------------------
  function listMaterials(){
    if (!apiReady()) {
      log('listMaterials is empty; will retry');
      setTimeout(listMaterials, 160);
      return;
    }
    S.keys = window.__LM_MATERIALS__.keys();
    const sel = S.ui.materialSelect;
    sel.innerHTML = '';
    S.keys.forEach(k => {
      const opt = document.createElement('option');
      opt.value = k; opt.textContent = k;
      sel.appendChild(opt);
    });
    if (S.keys.length) sel.value = S.keys[0];
    log('materials listed (' + S.keys.length + ')');
  }

  // ---- UI Handlers --------------------------------------------------------
  function onSelectChange(){
    S.current.key = S.ui.materialSelect.value;
    const p = {
      key: S.current.key,
      opacity: parseFloat(S.ui.opacityRange.value || '1'),
      doubleSided: !!S.ui.doubleSided?.checked,
      unlit: !!S.ui.unlit?.checked
    };
    log('apply model', 'key=' + p.key, 'opacity=' + p.opacity, 'ds=' + p.doubleSided, 'unlit=' + p.unlit);
    applyToModel(p);
    // saveはctxが整ってから別途（描画と分離）
  }
  function onUIChange(){ onSelectChange(); }

  // ---- Wire once ----------------------------------------------------------
  function wireOnce(){
    if (S.wired) return;
    pickUI();
    S.ui.materialSelect.addEventListener('change', onSelectChange);
    if (S.ui.opacityRange) S.ui.opacityRange.addEventListener('input', onUIChange);
    if (S.ui.doubleSided)  S.ui.doubleSided.addEventListener('change', onUIChange);
    if (S.ui.unlit)        S.ui.unlit.addEventListener('change', onUIChange);
    S.wired = true;
    log('V6_16g_SAFE_UI_PIPELINE.A2.2 wireOnce complete');
  }

  // ---- Sheet context (保存は後段) ----------------------------------------
  window.addEventListener('lm:sheet-context', (e)=>{
    S.ctxReady = !!(e?.detail?.spreadsheetId);
    log('sheet ctx ready');
  });

  // ---- Scene ready: kick --------------------------------------------------
  window.addEventListener('lm:scene-ready', ()=>{
    // indexは viewer.bridge.module.js 側が行う
    setTimeout(()=>{
      try { wireOnce(); } catch(e){ warn(e.message); return; }
      listMaterials();
      // 初回適用
      onSelectChange();
    }, 0);
    log('EVENT lm:scene-ready');
  });

  // 直後ロードでも試す
  setTimeout(()=>{
    try { wireOnce(); } catch(e){ /* wait */ return; }
    listMaterials();
  }, 600);
  log('V6_16g_SAFE_UI_PIPELINE.A2.2 boot');
})();
