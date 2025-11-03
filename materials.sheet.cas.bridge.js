
/*!
 * materials.sheet.cas.bridge.js
 * V6_16h_SAFE_UI_PIPELINE.A2.7
 * Adds CAS-style helpers on top of existing sheet bridge.
 * Non-destructive: new global window.__LM_MAT_SHEET__ with getLatestSettings/saveSettings.
 */
(function(){
  const TAG = "[mat-sheet-cas]";
  if (window.__LM_MAT_SHEET__ && window.__LM_MAT_SHEET__.__version) {
    console.log(TAG, "already installed", window.__LM_MAT_SHEET__.__version);
    return;
  }

  const state = {
    spreadsheetId: null,
    materialsSheetName: "materials",   // fallback sheet name
    headerMap: null,                   // columnName -> index
    lastHeaderRow: null,
  };

  // Try to pick auth fetch helper if present
  const authFetch = (url, options={}) => {
    if (typeof window.__lm_fetchJSONAuth === "function") {
      return window.__lm_fetchJSONAuth(url, options);
    }
    // fallback to normal fetch (might fail for protected spreadsheets)
    return fetch(url, options).then(r=>r.json());
  };

  // Listen to sheet context
  window.addEventListener("lm:sheet-context", (ev)=>{
    try {
      const d = ev.detail || ev;
      if (d && d.spreadsheetId) {
        state.spreadsheetId = d.spreadsheetId;
        console.log(TAG, "sheet-context bound:", d);
      }
    } catch(e){
      console.warn(TAG, "sheet-context bind error", e);
    }
  }, { once:false });

  function ensureSpreadsheetId(){
    if (!state.spreadsheetId) throw Object.assign(new Error("No spreadsheetId yet"), { code:"NO_SHEET_CTX" });
  }

  // Load entire "materials" range once to build a header map and allow a latest-by-key scan.
  async function loadAllRows(){
    ensureSpreadsheetId();
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(state.spreadsheetId)}/values/${encodeURIComponent(state.materialsSheetName)}?majorDimension=ROWS`;
    const j = await authFetch(url);
    const values = j && j.values || [];
    if (!values.length) return { header:[], rows:[] };

    const header = values[0];
    const rows = values.slice(1);
    const map = {};
    header.forEach((name, idx)=>{ map[(name||"").trim()] = idx; });
    state.headerMap = map;
    state.lastHeaderRow = header;
    return { header, rows };
  }

  function rowToSettings(row){
    const m = state.headerMap || {};
    const pick = (name, fallback=null) => {
      const i = m[name];
      return (i===undefined || i===null || row[i]===undefined) ? fallback : row[i];
    };
    // Common columns the project has been using
    const materialKey = pick("materialKey") || pick("key") || pick("material_key");
    const opacity     = parseFloat(pick("opacity", "1")) || 1;
    const unlit       = (""+pick("unlit","")).toLowerCase()==="true";
    const doubleSided = (""+pick("doubleSided","")).toLowerCase()==="true";
    const colorKey    = pick("colorKey") || null;
    const threshold   = pick("threshold")!=null ? Number(pick("threshold")) : null;
    const feather     = pick("feather")!=null ? Number(pick("feather")) : null;
    const updatedAt   = pick("updatedAt") || pick("updated_at") || null;
    const rev         = pick("rev") || updatedAt || null;
    return {
      materialKey, opacity, unlit, doubleSided, colorKey, threshold, feather, updatedAt, rev
    };
  }

  async function getLatestSettings(materialKey){
    if (!materialKey) throw new Error("materialKey required");
    const { rows } = await loadAllRows();
    let latest = null;
    let latestTs = -Infinity;
    const m = state.headerMap || {};
    const keyIdx = m.materialKey ?? m.key ?? m.material_key;
    const updatedIdx = m.updatedAt ?? m.updated_at ?? m.timestamp ?? m.rev;

    for (const r of rows){
      const key = (keyIdx!=null && r[keyIdx]!=null) ? r[keyIdx] : null;
      if (key !== materialKey) continue;
      let tsRaw = (updatedIdx!=null && r[updatedIdx]!=null) ? r[updatedIdx] : null;
      // parse to comparable
      let tsNum = Date.parse(tsRaw);
      if (!isFinite(tsNum)) {
        // fallback: if rev looks numeric
        tsNum = Number(tsRaw);
      }
      if (!isFinite(tsNum)) tsNum = Date.now(); // last resort
      if (tsNum > latestTs){
        latestTs = tsNum;
        latest = r;
      }
    }
    if (!latest) return null;
    const s = rowToSettings(latest);
    return { settings: s, rev: s.rev || String(latestTs) };
  }

  // Append a row to "materials". If prevRev is set, perform a CAS check by re-reading latest.
  async function saveSettings(materialKey, settings, prevRev){
    if (!materialKey) throw new Error("materialKey required");
    ensureSpreadsheetId();
    // CAS: check current
    if (prevRev != null){
      const cur = await getLatestSettings(materialKey);
      if (cur && cur.rev && String(cur.rev) !== String(prevRev)){
        const err = Object.assign(new Error("Conflict: rev mismatch"), { code:409, current:cur });
        throw err;
      }
    }

    // Build row using known header (or a default header)
    const header = state.lastHeaderRow || [
      "materialKey","opacity","unlit","doubleSided","colorKey","threshold","feather","updatedAt","rev"
    ];
    const m = {};
    // normalize settings numbers/bools to strings for Sheets
    const toS = (v)=> (v===undefined || v===null) ? "" : String(v);
    m.materialKey = materialKey;
    m.opacity     = settings.opacity;
    m.unlit       = settings.unlit;
    m.doubleSided = settings.doubleSided;
    m.colorKey    = settings.colorKey;
    m.threshold   = settings.threshold;
    m.feather     = settings.feather;
    const nowIso  = new Date().toISOString();
    m.updatedAt   = nowIso;
    m.rev         = nowIso; // use ISO time as rev

    const row = header.map(h => toS(m[h]));

    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(state.spreadsheetId)}/values/${encodeURIComponent(state.materialsSheetName)}:append?valueInputOption=USER_ENTERED`;
    const body = { values: [ row ] };
    const j = await authFetch(url, {
      method:"POST",
      headers: { "Content-Type":"application/json" },
      body: JSON.stringify(body)
    });
    // Best effort: return new rev
    return { rev: m.rev };
  }

  window.__LM_MAT_SHEET__ = {
    __version: "A2.7",
    getLatestSettings,
    saveSettings,
    _debug: { state }
  };

  console.log(TAG, "installed", window.__LM_MAT_SHEET__.__version);
})();
