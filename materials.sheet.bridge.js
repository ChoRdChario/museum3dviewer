// materials.sheet.bridge.js  v2.1
(function () {
  const Q = [];
  let ctx = null;
  let busy = false;

  console.log('[mat-sheet v2.1] armed');

  const haveAuthFetch = () => typeof window.__lm_fetchJSONAuth === 'function';
  const enqueue = (payload) => { Q.push(payload); drain(); };

  async function ensureSheetExists(spreadsheetId) {
    const fetchAuth = window.__lm_fetchJSONAuth;
    try {
      const meta = await fetchAuth(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`, { method: 'GET' });
      const has = !!meta.sheets?.some(s => s.properties?.title === '__LM_MATERIALS');
      if (has) return true;
      await fetchAuth(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ requests: [{ addSheet: { properties: { title: '__LM_MATERIALS' } } }] })
      });
      return true;
    } catch (e) {
      console.warn('[mat-sheet] ensureSheetExists warn', e?.message || e);
      return false;
    }
  }

  async function append(spreadsheetId, row) {
    const fetchAuth = window.__lm_fetchJSONAuth;
    await ensureSheetExists(spreadsheetId);
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent('__LM_MATERIALS')}!A1:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
    const body = { values: [row] };
    return fetchAuth(url, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body) });
  }

  async function drain() {
    if (busy || !ctx || !haveAuthFetch() || !Q.length) return;
    busy = true;
    try {
      while (Q.length) {
        const p = Q.shift();
        const row = [p.updatedAt, p.updatedBy || 'ui', String(ctx.sheetGid ?? ''), p.materialKey, Number(p.opacity)];
        await append(ctx.spreadsheetId, row);
        console.log('[mat-sheet] appended', row);
      }
    } catch (e) {
      console.warn('[mat-sheet] append failed; will retry later', e?.message || e);
    } finally { busy = false; }
  }

  window.addEventListener('lm:sheet-context', (e) => {
    ctx = { spreadsheetId: e.detail?.spreadsheetId, sheetGid: e.detail?.sheetGid };
    console.log('[mat-sheet v2.1] sheet-context bound:', ctx.spreadsheetId, 'gid=', ctx.sheetGid);
    drain();
  });

  window.addEventListener('lm:mat-opacity', (e) => {
    const d = e.detail || {};
    enqueue({ updatedAt: d.updatedAt || new Date().toISOString(), updatedBy: d.updatedBy || 'ui', materialKey: d.materialKey, opacity: d.opacity });
  });

  let tries = 0;
  const t = setInterval(() => {
    if (haveAuthFetch() || tries++ > 60) { clearInterval(t); drain(); }
  }, 1000);
})();
