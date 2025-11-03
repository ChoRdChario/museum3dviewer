
/* material.ui.silence.patch.js  v2.4
   Fix: When switching material (A -> B), prevent A's UI state from leaking into B.
   Strategy:
     1) On SELECT change (capture), immediately enter a "silence window" that blocks input/change.
     2) During the window, synchronously set the sliders to B's *stored* value
        (prefer sheet-bridge cache; fallback to localStorage persisted cache).
     3) Do NOT fire input/change while reflecting.
     4) Maintain cache by observing real user input (outside of silence) and persisting per (docId, matKey).
*/

(function(){
  const TAG = "[silence-patch v2.4]";
  if (window.__lm_silence_patch && window.__lm_silence_patch.version >= 204) {
    console.log(TAG, "already installed");
    return;
  }

  const SILENCE_MS = 420;
  const LS_KEY = "__lm_mat_cache_v1"; // localStorage fallback cache
  const state = {
    silenced: false,
    until: 0,
    version: 204,
    ctx: {
      spreadsheetId: null,
      sheetGid: null,
    },
  };

  // Expose for debugging
  window.__lm_silence_patch = state;

  // ---- Cache helpers -------------------------------------------------------
  function readLS() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || "{}"); } catch(e){ return {}; }
  }
  function writeLS(obj) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(obj)); } catch(e){}
  }
  function cacheKey(spreadsheetId, matKey) {
    return (spreadsheetId||"__no_spreadsheet__") + "::" + (matKey||"");
  }
  function getCachedOpacity(spreadsheetId, matKey) {
    // 1) sheet-bridge live cache (if available)
    try {
      const br = window.lmMaterialsSheetBridge || window.__lm_mat_sheet_bridge || null;
      if (br && typeof br.getCachedOpacity === "function") {
        const v = br.getCachedOpacity(matKey);
        if (typeof v === "number") return v;
      }
    } catch(e){}

    // 2) localStorage fallback
    const obj = readLS();
    const key = cacheKey(spreadsheetId, matKey);
    if (Object.prototype.hasOwnProperty.call(obj, key)) return obj[key];
    return null;
  }
  function setCachedOpacity(spreadsheetId, matKey, value) {
    // write to LS
    const obj = readLS();
    obj[cacheKey(spreadsheetId, matKey)] = value;
    writeLS(obj);
    // optional: notify sheet-bridge if helper exists
    try {
      const br = window.lmMaterialsSheetBridge || window.__lm_mat_sheet_bridge || null;
      if (br && typeof br.setCachedOpacity === "function") {
        br.setCachedOpacity(matKey, value);
      }
    } catch(e){}
  }

  // Try to hook sheet-context events to learn spreadsheetId
  window.addEventListener("lm:sheet-context", (ev)=>{
    try {
      const d = ev.detail || {};
      state.ctx.spreadsheetId = d.spreadsheetId || state.ctx.spreadsheetId;
      state.ctx.sheetGid = d.sheetGid || state.ctx.sheetGid;
      console.log(TAG, "sheet-context", state.ctx);
    } catch(e){}
  }, {passive:true});

  // ---- Find UI elements defensively ---------------------------------------
  function qs(sel){ return document.querySelector(sel); }
  function qsa(sel){ return Array.from(document.querySelectorAll(sel)); }

  // Heuristics for material select & sliders
  function findMaterialSelect() {
    // common ids/classes used in this project
    return qs("#materialSelect") || qs('select[name="material"]') || qs('.lm-material-select') || qs('select[data-lm="material"]');
  }
  function findOpacityInputs() {
    // Return likely sliders/number inputs that control opacity
    const sliders = qsa('input[type="range"]#opacityRange, input[type="range"][name="opacity"], input[type="range"].lm-opacity, input[type="range"][data-lm="opacity"]');
    const numbers = qsa('input[type="number"]#opacityNumber, input[type="number"][name="opacity"], input[type="number"].lm-opacity, input[type="number"][data-lm="opacity"]');
    return { sliders, numbers };
  }

  // ---- Silence gate (capture) ---------------------------------------------
  function now(){ return performance.now(); }
  function enterSilence(ms = SILENCE_MS) {
    state.silenced = true;
    state.until = now() + ms;
    // Ensure exit in any case
    setTimeout(exitSilence, ms + 40);
  }
  function exitSilence() {
    if (now() >= state.until) {
      state.silenced = false;
    } else {
      // keep a tiny buffer
      setTimeout(exitSilence, Math.max(10, state.until - now()));
    }
  }

  // Globally suppress input/change during silence (capture)
  function globalBlocker(ev){
    if (!state.silenced) return;
    // Always block user-generated input/change during silence
    // (Reflection never dispatches real events)
    ev.stopImmediatePropagation();
    ev.preventDefault();
  }
  window.addEventListener("input", globalBlocker, true);
  window.addEventListener("change", globalBlocker, true);

  // ---- Reflection without events ------------------------------------------
  function reflectOpacityToUI(value01){
    const { sliders, numbers } = findOpacityInputs();
    const clamp = (v)=> Math.max(0, Math.min(1, v));
    const v01 = clamp(value01);
    // set slider(s)
    sliders.forEach(el=>{
      try {
        // avoid triggering any listeners by not dispatching events
        el.value = (el.max && Number(el.max) > 1) ? String(Math.round(v01 * Number(el.max))) : String(v01);
        // also update any textual label if directly bound (optional)
        if (el.hasAttribute("data-bind-target")) {
          const t = qs(el.getAttribute("data-bind-target"));
          if (t) t.textContent = el.value;
        }
      } catch(e){}
    });
    // set number(s)
    numbers.forEach(el=>{
      try {
        const step = Number(el.step || "0.01");
        const rounded = Math.round(v01 / step) * step;
        el.value = String(clamp(rounded));
      } catch(e){}
    });
  }

  // ---- Observe real user input to maintain cache --------------------------
  function installUserInputObserver(){
    const { sliders, numbers } = findOpacityInputs();
    const record = (ev)=>{
      if (state.silenced) return; // ignore during silence/reflection
      const select = findMaterialSelect();
      const matKey = select ? select.value : null;
      if (!matKey) return;
      // compute value in 0..1 from the event target
      let v01 = null;
      try {
        const el = ev.target;
        if (el && el.type === "range") {
          const max = Number(el.max || "1");
          const val = Number(el.value || "0");
          v01 = max > 1 ? (val / max) : val;
        } else if (el && el.type === "number") {
          v01 = Number(el.value || "0");
        }
        if (typeof v01 === "number" && !Number.isNaN(v01)) {
          setCachedOpacity(state.ctx.spreadsheetId, matKey, Math.max(0, Math.min(1, v01)));
        }
      } catch(e){}
    };
    [...sliders, ...numbers].forEach(el=>{
      el.removeEventListener("input", record);
      el.addEventListener("input", record);
      el.removeEventListener("change", record);
      el.addEventListener("change", record);
    });
  }

  // ---- SELECT change handler (capture) ------------------------------------
  function onSelectChangeCapture(ev){
    // Enter silence immediately
    enterSilence(SILENCE_MS);
    const select = ev.currentTarget;
    const matKey = select && select.value;
    // Synchronously lookup stored value
    let v01 = getCachedOpacity(state.ctx.spreadsheetId, matKey);
    if (typeof v01 !== "number") {
      // default if unknown
      v01 = 1.0;
    }
    // Reflect without emitting events
    reflectOpacityToUI(v01);
    // keep inputs wired for cache
    setTimeout(installUserInputObserver, 0);
    console.log(TAG, "switch ->", matKey, "reflect", v01);
  }

  function install(){
    const sel = findMaterialSelect();
    if (!sel) {
      console.log(TAG, "material SELECT not found; retrying...");
      setTimeout(install, 300);
      return;
    }
    // Ensure capture-phase listener (runs before bubbling handlers)
    sel.removeEventListener("change", onSelectChangeCapture, true);
    sel.addEventListener("change", onSelectChangeCapture, true);

    installUserInputObserver();

    console.log(TAG, "installed");
  }

  // Try install now and after DOM loaded
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", install, {once:true});
  } else {
    install();
  }
})();
