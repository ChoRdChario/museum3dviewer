
// materials.sheet.persist.js v1.1
// Persists per-material opacity into a dedicated __LM_MATERIALS sheet (per caption sheet/spreadsheet)
(() => {
  const TAG = "[mat-sheet-persist v1.1]";
  const SHEET_TITLE = "__LM_MATERIALS";
  const HEADERS = ["materialKey","opacity","updatedAt","updatedBy","sheetGid"];

  let spreadsheetId = null;
  let sheetId = null;     // numeric sheetId for __LM_MATERIALS
  let sheetReady = false;

  // UI anchors (loose selectors, robust to markup changes)
  function q(sel){ return document.querySelector(sel); }
  function pickSelect() {
    return q("#pm-material") || q('#pm-opacity select') || q('[data-lm="mat-select"]') || q('section.lm-panel-material select');
  }
  function pickRange() {
    return q('#pm-opacity input[type="range"]') || q('#opacityRange') || q('section.lm-panel-material input[type="range"]');
  }

  // Simple debounce
  function debounce(fn, ms=300){
    let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a),ms); };
  }

  // Ensure auth fetch exists before using it
  async function waitAuthFetch(timeoutMs=5000){
    const t0 = Date.now();
    while (typeof window.__lm_fetchJSONAuth !== 'function') {
      if (Date.now() - t0 > timeoutMs) throw new Error("__lm_fetchJSONAuth not present");
      await new Promise(r=>setTimeout(r,120));
    }
  }

  async function ensureSheet(spreadsheetId) {
    await waitAuthFetch(8000);
    // 1) List sheets
    const meta = await window.__lm_fetchJSONAuth(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=sheets(properties(sheetId,title))`
    );
    const sheets = (meta?.sheets || []).map(s=>s.properties);
    const found = sheets.find(p => p.title === SHEET_TITLE);
    if (found) { sheetId = found.sheetId; sheetReady = true; return found; }

    // 2) Create missing sheet + header row
    const requests = [
      { addSheet: { properties: { title: SHEET_TITLE, gridProperties: { frozenRowCount: 1 } } } },
      { updateCells: {
          range: { sheetId: null, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: HEADERS.length },
          rows: [ { values: HEADERS.map(h => ({ userEnteredValue: { stringValue: h }, userEnteredFormat: { textFormat: { bold: true } } })) } ],
          fields: "userEnteredValue,userEnteredFormat.textFormat.bold"
      } }
    ];
    // addSheet response sheetId is only known after the call; we do two calls for simplicity
    const res1 = await window.__lm_fetchJSONAuth(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`,
      { method: "POST", body: JSON.stringify({ requests: [requests[0]] }) }
    );
    const newSheetId = res1?.replies?.[0]?.addSheet?.properties?.sheetId;
    if (newSheetId == null) throw new Error("addSheet failed");
    sheetId = newSheetId;

    // header write (A1:E1)
    await window.__lm_fetchJSONAuth(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`,
      {
        method: "POST",
        body: JSON.stringify({
          requests: [{
            updateCells: {
              range: { sheetId: sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: HEADERS.length },
              rows: [{ values: HEADERS.map(h => ({ userEnteredValue: { stringValue: h }, userEnteredFormat: { textFormat: { bold: true } } })) }],
              fields: "userEnteredValue,userEnteredFormat.textFormat.bold"
            }
          }]
        })
      }
    );

    sheetReady = true;
    return { sheetId };
  }

  async function upsertOpacity(spreadsheetId, materialKey, opacity, sheetGid) {
    if (!sheetReady) await ensureSheet(spreadsheetId);
    // Read existing keys in col A
    const rangeA = `${encodeURIComponent(SHEET_TITLE)}!A:A`;
    const dataA = await window.__lm_fetchJSONAuth(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${rangeA}`
    );
    const rows = (dataA?.values || []).map(r => (r[0]||"").toString());
    let rowIndex = rows.findIndex(v => v === materialKey);
    const now = new Date().toISOString();
    const user = (window.__LM_USER_EMAIL || window.__LM_USER || "unknown").toString();

    if (rowIndex < 0) {
      // append new row
      const appendRange = `${SHEET_TITLE}!A1:E1`;
      const body = {
        valueInputOption: "RAW",
        data: [{
          range: appendRange,
          majorDimension: "ROWS",
          values: [[materialKey, opacity, now, user, sheetGid ?? ""]]
        }]
      };
      await window.__lm_fetchJSONAuth(
        `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values:batchUpdate`,
        { method: "POST", body: JSON.stringify(body) }
      );
    } else {
      // update existing row (rowIndex is 0-based in our array, +1 for 1-based sheet row)
      const rowNum = rowIndex + 1;
      const updateRange = `${SHEET_TITLE}!A${rowNum}:E${rowNum}`;
      const body = {
        valueInputOption: "RAW",
        data: [{
          range: updateRange,
          majorDimension: "ROWS",
          values: [[materialKey, opacity, now, user, sheetGid ?? ""]]
        }]
      };
      await window.__lm_fetchJSONAuth(
        `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values:batchUpdate`,
        { method: "POST", body: JSON.stringify(body) }
      );
    }
  }

  // Wire UI → persist
  function wireUI() {
    const sel = pickSelect();
    const rng = pickRange();
    if (!sel || !rng) return console.warn(TAG, "UI anchors missing");
    const persistSelected = debounce(async () => {
      try {
        if (!spreadsheetId) return;
        const key = (sel.value || "").trim();
        if (!key) return;
        const opacity = parseFloat(rng.value || "1") || 1;
        await upsertOpacity(spreadsheetId, key, opacity, window.__LM_SHEET_GID || null);
        console.log(TAG, "persisted", {key, opacity});
      } catch (e) {
        console.warn(TAG, "persist error:", e);
      }
    }, 350);

    sel.addEventListener("change", persistSelected, {passive: true});
    rng.addEventListener("change", persistSelected, {passive: true});
    rng.addEventListener("mouseup", persistSelected, {passive: true});
  }

  // Listen for sheet-context
  window.addEventListener("lm:sheet-context", (ev) => {
    spreadsheetId = ev?.detail?.spreadsheetId || ev?.spreadsheetId || null;
    window.__LM_SHEET_GID = ev?.detail?.sheetGid ?? ev?.sheetGid ?? null;
    sheetReady = false;
    if (spreadsheetId) {
      ensureSheet(spreadsheetId).then(
        ()=>console.log(TAG, "sheet bound", spreadsheetId),
        (e)=>console.warn(TAG, "ensureSheet Error:", e)
      );
    }
  });

  // Late wire in case UI builds after this loads
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wireUI);
  } else {
    wireUI();
  }
  console.log(TAG, "loaded");
})();
