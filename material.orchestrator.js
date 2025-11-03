
/*!
 * material.orchestrator.js
 * V6_16h_SAFE_UI_PIPELINE.A2.7
 * Per-material draft isolation + sheet-backed initialization + CAS save.
 * Works even if THREE/scene isn't ready yet.
 */
(function(){
  const TAG = "[mat-orch]";
  console.log(TAG, "A2.7 boot");

  // Config: selector discovery (kept conservative to avoid breaking UI)
  const SEL = {
    panelRoot:    "#materialTab, #materialsTab, [data-lm='materials-tab']",
    materialKey:  "#materialSelect, select[data-lm='material-key']",
    opacity:      "#opacityRange, input[data-lm='opacity']",
    unlit:        "#unlitCheckbox, input[data-lm='unlit']",
    doubleSided:  "#doubleSidedCheckbox, input[data-lm='doubleSided']",
    colorKey:     "#colorKeyInput, input[data-lm='colorKey']",
    threshold:    "#colorThreshold, input[data-lm='threshold']",
    feather:      "#colorFeather, input[data-lm='feather']",
    saveBtn:      "#matSaveBtn, button[data-lm='save']",
    revertBtn:    "#matRevertBtn, button[data-lm='revert']",
    status:       "#matStatus, [data-lm='status']"
  };

  // Internal state
  let selectToken = 0;
  const draftByKey = new Map();
  const loadedRevByKey = new Map();
  let spreadsheetReady = false;
  let sceneReady = false;
  let ui = null;

  // viewer bridge (optional)
  function tryPreview(key, d){
    try {
      if (window.__LM_VIEWER_BRIDGE__ && typeof window.__LM_VIEWER_BRIDGE__.previewMaterial === "function"){
        window.__LM_VIEWER_BRIDGE__.previewMaterial(key, d);
      } else if (window.viewerBridge && typeof window.viewerBridge.previewMaterial === "function"){
        window.viewerBridge.previewMaterial(key, d);
      }
    } catch(e){ console.warn(TAG, "preview error", e); }
  }

  function extractSceneDefaults(key){
    try {
      if (window.__LM_VIEWER_BRIDGE__ && typeof window.__LM_VIEWER_BRIDGE__.extractDefaults === "function"){
        return window.__LM_VIEWER_BRIDGE__.extractDefaults(key);
      }
    } catch(e){}
    return { opacity:1, unlit:false, doubleSided:false, colorKey:"", threshold:"", feather:"" };
  }

  function setStatus(text){
    const el = document.querySelector(SEL.status);
    if (el) el.textContent = text;
  }

  function getKeyFromUI(){
    const s = document.querySelector(SEL.materialKey);
    return s && s.value || null;
  }

  function setForm(d){
    // only touch fields that exist; avoid breaking other UI
    const set = (sel, val, type)=>{
      const el = document.querySelector(sel);
      if (!el) return;
      if (type==="bool"){
        el.checked = !!val;
      } else {
        el.value = (val==null ? "" : val);
      }
      el.dispatchEvent(new Event("input", { bubbles:true })); // if app listens
      el.dispatchEvent(new Event("change", { bubbles:true }));
    };
    set(SEL.opacity, d.opacity);
    set(SEL.unlit, d.unlit, "bool");
    set(SEL.doubleSided, d.doubleSided, "bool");
    set(SEL.colorKey, d.colorKey);
    set(SEL.threshold, d.threshold);
    set(SEL.feather, d.feather);
  }

  function readDraftFromUI(){
    const pick = (sel, type)=>{
      const el = document.querySelector(sel);
      if (!el) return undefined;
      return (type==="bool") ? !!el.checked : el.value;
    };
    const op = parseFloat(pick(SEL.opacity));
    return {
      opacity: isFinite(op) ? op : 1,
      unlit: !!pick(SEL.unlit, "bool"),
      doubleSided: !!pick(SEL.doubleSided, "bool"),
      colorKey: pick(SEL.colorKey) || "",
      threshold: pick(SEL.threshold) || "",
      feather: pick(SEL.feather) || ""
    };
  }

  function discoverUI(){
    const root = document.querySelector(SEL.panelRoot);
    const matSel = document.querySelector(SEL.materialKey);
    if (!root || !matSel){
      return null;
    }
    const save = document.querySelector(SEL.saveBtn);
    const revert = document.querySelector(SEL.revertBtn);
    return { root, matSel, save, revert };
  }

  function wireUI(){
    if (ui) return true;
    ui = discoverUI();
    if (!ui) return false;

    // material selection change
    ui.matSel.addEventListener("change", ()=>{
      const k = getKeyFromUI();
      if (!k) return;
      onMaterialSelected(k);
    });

    // live change to build draft
    const liveSelectors = [SEL.opacity, SEL.unlit, SEL.doubleSided, SEL.colorKey, SEL.threshold, SEL.feather];
    liveSelectors.forEach(sel=>{
      const el = document.querySelector(sel);
      if (!el) return;
      el.addEventListener("input", onLiveChange);
      el.addEventListener("change", onLiveChange);
    });

    // save
    if (ui.save){
      ui.save.addEventListener("click", onSave);
    }

    // revert to defaults (scene)
    if (ui.revert){
      ui.revert.addEventListener("click", async ()=>{
        const key = getKeyFromUI();
        if (!key) return;
        const base = extractSceneDefaults(key);
        draftByKey.set(key, structuredClone(base));
        setForm(base);
        tryPreview(key, base);
        setStatus("Defaults loaded (not saved)");
      });
    }

    console.log(TAG, "UI wired");
    return true;
  }

  function onLiveChange(){
    const key = getKeyFromUI();
    if (!key) return;
    const d = readDraftFromUI();
    draftByKey.set(key, d);
    tryPreview(key, d);
    setStatus("Draft (not saved)");
  }

  async function onMaterialSelected(key){
    const token = ++selectToken;
    setStatus("Loading...");
    // disable save during load
    if (ui && ui.save) ui.save.disabled = true;
    try {
      // Pull latest from sheet if helper is present
      let latest = null;
      if (window.__LM_MAT_SHEET__ && typeof window.__LM_MAT_SHEET__.getLatestSettings === "function"){
        try {
          latest = await window.__LM_MAT_SHEET__.getLatestSettings(key);
        } catch(e){
          console.warn(TAG, "getLatestSettings failed", e);
        }
      }
      if (token !== selectToken) return; // race guard

      const base = latest?.settings ?? extractSceneDefaults(key);
      draftByKey.set(key, structuredClone(base));
      loadedRevByKey.set(key, latest?.rev ?? "0");

      setForm(base);
      tryPreview(key, base);
      setStatus(latest ? "Loaded from sheet" : "Loaded defaults");
    } finally {
      if (token === selectToken && ui && ui.save) ui.save.disabled = false;
    }
  }

  async function onSave(){
    const key = getKeyFromUI();
    if (!key) return;
    const draft = draftByKey.get(key) || readDraftFromUI();
    const prevRev = loadedRevByKey.get(key);
    setStatus("Saving...");
    if (ui && ui.save) ui.save.disabled = true;
    try {
      if (!(window.__LM_MAT_SHEET__ && typeof window.__LM_MAT_SHEET__.saveSettings === "function")){
        console.warn(TAG, "saveSettings not available");
        setStatus("Save API missing");
        return;
      }
      try {
        const { rev } = await window.__LM_MAT_SHEET__.saveSettings(key, draft, prevRev);
        loadedRevByKey.set(key, rev);
        setStatus("Saved");
      } catch(e){
        if (e && e.code === 409){
          // conflict
          const pull = confirm("他の更新がありました。最新を取り込みますか？\nOK=取り込む / Cancel=こちらを強制保存");
          if (pull){
            const latest = await window.__LM_MAT_SHEET__.getLatestSettings(key);
            if (latest){
              draftByKey.set(key, latest.settings);
              loadedRevByKey.set(key, latest.rev);
              setForm(latest.settings);
              tryPreview(key, latest.settings);
              setStatus("Pulled latest");
            } else {
              setStatus("Conflict: but no latest found");
            }
          } else {
            const { rev } = await window.__LM_MAT_SHEET__.saveSettings(key, draft, /*prevRev*/null);
            loadedRevByKey.set(key, rev);
            setStatus("Force-saved");
          }
        } else {
          console.error(TAG, "save failed", e);
          setStatus("Save error");
        }
      }
    } finally {
      if (ui && ui.save) ui.save.disabled = false;
    }
  }

  // Boot sequence: wire UI when available; respond to sheet/scene readiness.
  function boot(){
    const ok = wireUI();
    if (!ok){
      // keep trying a bit; but don't spam logs
      let tries = 0;
      const timer = setInterval(()=>{
        tries++;
        if (wireUI()){
          clearInterval(timer);
        } else if (tries >= 60){
          clearInterval(timer);
          console.warn(TAG, "UI still not found; keep idle");
        }
      }, 250);
    }
  }

  // Scene ready (optional)
  window.addEventListener("lm:scene-ready", ()=>{
    sceneReady = true;
  });

  // Sheet context ready
  window.addEventListener("lm:sheet-context", ()=>{
    spreadsheetReady = true;
  });

  // If material already selected (SSR), hydrate once after boot
  window.addEventListener("DOMContentLoaded", boot);
  if (document.readyState === "complete" || document.readyState === "interactive"){
    boot();
  }
})();


/* ===== HOTFIX_BIND_MATERIALS A3.3 (minimal) ===== */
(() => {
  const log = (...a)=>console.log('[mat-orch.fix]', ...a);
  const once = (fn)=>{ let ran=false; return (...a)=>{ if(!ran){ ran=true; try{fn(...a)}catch(e){console.error(e)} } } };

  function qsAllDeep(root, sel) {
    const out=[]; const walk=(n)=>{ if(!n) return;
      try{ n.querySelectorAll(sel).forEach(x=>out.push(x)); }catch{}
      for(const c of (n.children||[])){ if(c.shadowRoot) walk(c.shadowRoot); walk(c); }
    }; walk(root); return out;
  }

  function collectGlbMaterials(scene) {
    const set=new Set(), out=[];
    scene?.traverse?.(o=>{
      if(!o?.isMesh) return;
      (Array.isArray(o.material)?o.material:[o.material]).forEach((m,i)=>{
        if(!m) return;
        const name=(m.name||'').trim();
        if(m.type==='MeshBasicMaterial' && !name) return; // overlay除外
        const key = m.uuid || name || `${o.uuid}:${i}`;
        if(!set.has(key)){ set.add(key); out.push({key, label: name || (o.name ? `${o.name} (${m.type||'Material'})` : (m.type||'Material'))}); }
      });
    });
    return out;
  }

  const pumpOnce = once(() => {
    const br = window.__LM_VIEWER_BRIDGE__ || window.LM_VIEWER_BRIDGE || window.viewerBridge;
    const scene = br?.getScene?.();
    if(!scene){ log('scene missing; skip'); return; }

    const sel = (()=>{
      const cand = [
        '#pm-material','select[aria-label="Select material"]',
        '#materialSelect','#mat-select','#matKeySelect',
        'select[name*="material"]','select[id*="material"]'
      ];
      for(const s of cand){
        const found = qsAllDeep(document, s);
        if(found.length) return found[0];
      }
      return null;
    })();

    if(!sel){ log('select not found; skip'); return; }
    const mats = collectGlbMaterials(scene);
    if(!mats.length){ log('no GLB materials; skip'); return; }

    // 既存オプションを尊重しつつ（先頭のプレースホルダは残す）、重複を消して追加
    const have = new Set([...sel.options].map(o=>o.value));
    const frag = document.createDocumentFragment();
    mats.forEach(m=>{
      if(have.has(m.key)) return;
      const o=document.createElement('option');
      o.value=m.key; o.textContent=m.label||m.key;
      frag.appendChild(o);
    });
    sel.appendChild(frag);
    log('pumped', mats.length, 'materials into select');
  });

  // 1) 既存の scene-ready を利用
  window.addEventListener('lm:scene-ready', ()=> setTimeout(pumpOnce, 0), { once:false });

  // 2) Materialタブが可視化された瞬間にも
  document.addEventListener('click', (ev)=>{
    const t=ev.target;
    if(!t) return;
    const txt=(t.textContent||'').trim().toLowerCase();
    if(/material/.test(txt)) setTimeout(pumpOnce, 0);
  }, {capture:true});

  // 3) 直近のDOM変化を少しだけ観測（過剰な監視はしない）
  const panel = document.querySelector('#panel-material,[data-tab="material"],#material,[role="tabpanel"][aria-labelledby="tab-material"]') || document.body;
  const mo = new MutationObserver(() => pumpOnce());
  mo.observe(panel, {subtree:true, childList:true});

  // 4) フォールバック: 遅延リトライを数回
  let tries=0; const id=setInterval(()=>{ pumpOnce(); if(++tries>=10){ clearInterval(id); mo.disconnect(); } }, 300);

  // expose marker for probe1
  window.HOTFIX_BIND_MATERIALS = 'A3.3';
})();

