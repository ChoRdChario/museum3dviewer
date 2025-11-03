
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
    materialKey:  "#materialSelect, #pm-material, select[data-lm='material-key']",
    opacity:      "#opacityRange, #pm-opacity, input[data-lm='opacity']",
    unlit:        "#unlitCheckbox, #pm-unlit-like, input[data-lm='unlit']",
    doubleSided:  "#doubleSidedCheckbox, #pm-double-sided, input[data-lm='doubleSided']",
    colorKey:     "#colorKeyInput, input[data-lm='colorKey']",
    chromaEnable: "#chromaEnable, #pm-chroma-enable, input[data-lm='chromaEnable']",
    threshold:    "#colorThreshold, #pm-chroma-threshold, input[data-lm='threshold']",
    feather:      "#colorFeather, #pm-chroma-feather, input[data-lm='feather']",
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
