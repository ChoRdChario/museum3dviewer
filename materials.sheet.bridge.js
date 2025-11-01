
/*! materials.sheet.bridge.js */
(() => {
  const log = (...a) => console.log("[mat-sheet]", ...a);

  if (window.materialsSheetBridge?.__installed) return;

  const HEADER = ["updatedAt","updatedBy","modelKey","materialKey","opacity","flags","notes"];
  const SHEET_TITLE = "__LM_MATERIALS";

  function fjson(url, opts={}) {
    const f = (window.__lm_fetchJSONAuth || window.__lm_fetchJSON || window.fetch);
    if (!f) throw new Error("__lm_fetchJSONAuth missing");
    return f(url, opts);
  }

  async function getOrCreateSheet(spreadsheetId) {
    // Find target sheet by title; create if missing.
    const getUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`;
    const meta = await fjson(getUrl);
    const sheets = (meta.sheets || []).map(s => ({ id: s.properties.sheetId, title: s.properties.title }));
    const found = sheets.find(s => s.title === SHEET_TITLE);
    if (found) return { sheetId: found.id };

    const addUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`;
    const addRes = await fjson(addUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requests: [
          { addSheet: { properties: { title: SHEET_TITLE } } },
        ]
      })
    });
    const newId = addRes.replies?.[0]?.addSheet?.properties?.sheetId;
    // write header
    const headerUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(SHEET_TITLE+"!A1")}:append?valueInputOption=RAW`;
    await fjson(headerUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ values: [HEADER] })
    });
    return { sheetId: newId };
  }

  async function ensureSheet(spreadsheetId) {
    if (!spreadsheetId) throw new Error("spreadsheetId missing");
    const { sheetId } = await getOrCreateSheet(spreadsheetId);
    return { sheetId, title: SHEET_TITLE };
  }

  async function loadAll(spreadsheetId) {
    const { title } = await ensureSheet(spreadsheetId);
    const getUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(title)}?majorDimension=ROWS`;
    const res = await fjson(getUrl);
    const rows = (res.values || []).slice(1); // skip header
    const map = new Map(); // materialKey -> latest row
    for (const r of rows) {
      const [updatedAt, updatedBy, modelKey, materialKey, opacity, flags, notes] = r;
      map.set(materialKey, { updatedAt, updatedBy, modelKey, materialKey, opacity: opacity == null ? null : Number(opacity), flags, notes });
    }
    return map;
  }

  async function upsertOne(spreadsheetId, row) {
    const { title } = await ensureSheet(spreadsheetId);
    const appendUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(title)}:append?valueInputOption=RAW`;
    const values = [[
      row.updatedAt || new Date().toISOString(),
      row.updatedBy || (window.__lm_user || "unknown"),
      row.modelKey || (window.__lm_modelKey || "default"),
      row.materialKey,
      row.opacity,
      row.flags || "",
      row.notes || ""
    ]];
    await fjson(appendUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ values })
    });
  }

  window.materialsSheetBridge = {
    __installed: true,
    ensureSheet,
    loadAll,
    upsertOne,
  };

  log("ready");
})();
