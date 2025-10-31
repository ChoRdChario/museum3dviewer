
// materials.sheet.bridge.js  (V6_15d)
// Single-source implementation with in-module cache and :append fix.
// Installs window.matSheet = { loadAll, upsertOne, getOne, bindCtx }
(() => {
  const MOD = 'mat-sheet';
  const A1_TABLE = '__LM_MATERIALS!A:Z';
  const A1_APPEND = '__LM_MATERIALS!A:N';

  const state = {
    ctx: null,               // { spreadsheetId, sheetGid }
    header: [],
    cache: new Map(),        // materialKey -> latest record
  };

  function bindCtx(ctx) {
    state.ctx = ctx;
    console.log(`[${MOD}] sheet-context bound:`, ctx.spreadsheetId, 'gid=', ctx.sheetGid ?? 0);
  }

  // Listen for sheet context from sheet.ctx.bridge.js
  window.addEventListener('lm:sheet-context', (ev) => bindCtx(ev.detail), { once: false });

  function ensureAuth() {
    if (!window.__lm_fetchJSONAuth) throw new Error('__lm_fetchJSONAuth missing');
  }
  function ensureCtx() {
    if (!state.ctx || !state.ctx.spreadsheetId) throw new Error('spreadsheetId missing');
  }

  function rowToObj(header, row) {
    const o = {};
    for (let i = 0; i < header.length; i++) o[header[i]] = row[i];
    return o;
  }

  async function loadAll() {
    ensureAuth(); ensureCtx();
    const ssid = state.ctx.spreadsheetId;
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${ssid}/values/${encodeURIComponent(A1_TABLE)}?majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE`;
    const data = await window.__lm_fetchJSONAuth(url, { method: 'GET' });
    const rows = (data && data.values) || [];
    if (rows.length === 0) {
      state.header = [];
      state.cache.clear();
      console.log(`[${MOD}] loadAll: empty (no header row yet)`);
      return [];
    }
    state.header = rows[0];
    const out = [];
    state.cache.clear();
    for (let i = 1; i < rows.length; i++) {
      const rec = rowToObj(state.header, rows[i]);
      out.push(rec);
      if (rec.materialKey) state.cache.set(String(rec.materialKey), rec);
    }
    console.log(`[${MOD}] cache primed`, state.cache.size);
    return out;
  }

  function getOne(materialKey) {
    return state.cache.get(String(materialKey));
  }

  async function upsertOne(rec) {
    ensureAuth(); ensureCtx();
    const ssid = state.ctx.spreadsheetId;
    // Compose a minimal append row (A:N)
    const now = new Date().toISOString();
    const values = [[
      rec.materialKey ?? '',
      rec.name ?? '',
      rec.opacity ?? '',
      rec.unlit ? '1' : '',
      rec.doubleSided ? '1' : '',
      rec.chromaColor ?? '',
      rec.chromaThreshold ?? '',
      rec.chromaFeather ?? '',
      now,
      rec.updatedBy ?? 'ui',
      state.ctx.sheetGid ?? 0,
      rec.modelKey ?? ''
    ]];
    const body = { values };
    const qs = '?valueInputOption=RAW&insertDataOption=INSERT_ROWS';
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${ssid}/values/${encodeURIComponent(A1_APPEND)}:append${qs}`;
    await window.__lm_fetchJSONAuth(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    // Update cache with newest values
    const merged = { ...(state.cache.get(String(rec.materialKey)) || {}), ...rec, updatedAt: now };
    state.cache.set(String(rec.materialKey), merged);
    console.log(`[${MOD}] appended`, rec.materialKey);
    return merged;
  }

  // public api
  window.matSheet = { loadAll, upsertOne, getOne, bindCtx };
  console.log(`[${MOD}] ready`);
})();
