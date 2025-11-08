
/* materials.sheet.persist.js
 * v1.2 — create "__LM_MATERIALS" sheet if missing and persist opacity.
 * Requires: window.__lm_fetchJSONAuth (auth-polyfill or host app)
 */
(() => {
  const TAG = '[mat-sheet-persist v1.2]';
  console.log(TAG, 'loaded');

  const SHEET_TITLE = '__LM_MATERIALS';
  const HEADERS = ['materialKey','opacity','updatedAt','updatedBy','spreadsheetId','sheetGid'];

  function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }

  async function waitAuthFetch(maxMs=7000) {
    if (typeof window.__lm_fetchJSONAuth === 'function') return;
    const pEvt = new Promise(res => {
      const h = () => { window.removeEventListener('lm:auth-ready', h); res(); };
      window.addEventListener('lm:auth-ready', h);
    });
    const pPoll = (async () => {
      const t0 = performance.now();
      while (performance.now() - t0 < maxMs) {
        if (typeof window.__lm_fetchJSONAuth === 'function') return;
        await sleep(150);
      }
      throw new Error('__lm_fetchJSONAuth not present');
    })();
    await Promise.race([pEvt, pPoll]);
  }

  async function fetchJSONAuth(url, init){ 
    await waitAuthFetch(7000); 
    return window.__lm_fetchJSONAuth(url, init);
  }

  async function getSheetsMeta(spreadsheetId) {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=sheets.properties`;
    return fetchJSONAuth(url, {method:'GET'});
  }

  async function addSheet(spreadsheetId, title) {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`;
    const body = { requests: [{ addSheet: { properties: { title } } }] };
    return fetchJSONAuth(url, {method:'POST', body});
  }

  async function putHeader(spreadsheetId, title, headers) {
    const range = `${title}!A1:${String.fromCharCode(65 + headers.length - 1)}1`;
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?valueInputOption=RAW`;
    const body = { values: [headers] };
    return fetchJSONAuth(url, {method:'PUT', body});
  }

  async function ensureSheet(spreadsheetId) {
    const meta = await getSheetsMeta(spreadsheetId);
    const exists = (meta?.sheets||[]).some(s => s.properties?.title === SHEET_TITLE);
    if (!exists) {
      await addSheet(spreadsheetId, SHEET_TITLE);
      await putHeader(spreadsheetId, SHEET_TITLE, HEADERS);
      console.log(TAG, 'created sheet & headers');
    } else {
      await putHeader(spreadsheetId, SHEET_TITLE, HEADERS).catch(()=>{});
      console.log(TAG, 'sheet exists');
    }
  }

  async function appendOpacity(spreadsheetId, row) {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(SHEET_TITLE)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
    const body = { values: [row] };
    return fetchJSONAuth(url, {method:'POST', body});
  }

  function pickUI() {
    const sel = document.querySelector('#pm-material') 
             || document.querySelector('#pm-opacity select')
             || document.querySelector('[data-lm="mat-select"]')
             || document.querySelector('section.lm-panel-material select');
    const range = document.querySelector('#pm-range')
             || document.querySelector('#opacityRange')
             || document.querySelector('[data-lm="mat-range"]')
             || document.querySelector('section.lm-panel-material input[type="range"]');
    return {sel, range};
  }

  function debounce(fn, ms){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), ms); }; }

  // Wire when sheet-context comes in
  (function arm() {
    function onCtx(e){
      const ctx = e?.detail || e;
      const spreadsheetId = ctx?.spreadsheetId;
      if (!spreadsheetId) return;
      ensureSheet(spreadsheetId).catch(err=>console.warn(TAG, 'ensureSheet error:', err));

      const {sel, range} = pickUI();
      const getKey = () => (sel?.value || '').trim();
      const getOpacity = () => {
        const v = Number((range?.value ?? '1'));
        return Number.isFinite(v) ? v : 1;
      };
      const debounced = debounce(async () => {
        const key = getKey();
        if (!key) return;
        const row = [
          key,
          getOpacity(),
          new Date().toISOString(),
          'viewer',
          spreadsheetId,
          String(ctx?.sheetGid ?? '')
        ];
        try {
          await ensureSheet(spreadsheetId);
          await appendOpacity(spreadsheetId, row);
          console.log(TAG, 'persisted', {key, opacity: row[1]});
        } catch (err) {
          console.warn(TAG, 'persist error:', err);
        }
      }, 500);
      sel && sel.addEventListener('change', debounced, {passive:true});
      range && range.addEventListener('change', debounced, {passive:true});
      range && range.addEventListener('mouseup', debounced, {passive:true});
    }
    window.addEventListener('lm:sheet-context', onCtx);
  })();
})();
