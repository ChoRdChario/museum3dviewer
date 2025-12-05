
/*!
 * sheet.gid.map.js v1.1 (auth-aware)
 * - Resolves Sheet title <-> GID, cached per spreadsheetId
 * - Uses __lm_fetchJSONAuth when available, otherwise GIS token from gauth.module.js
 * - Safe, no side effects; attaches to window.LM_SHEET_GIDMAP
 */
(function () {
  const NS = 'LM_SHEET_GIDMAP';
  if (window[NS]) return; // idempotent

  /** in-memory cache: { [spreadsheetId]: { byTitle, byId, fetchedAt } } */
  const _cache = Object.create(null);

  function _log(...args){ try{ console.log('[gidmap]', ...args);}catch(_){} }
  function _warn(...args){ try{ console.warn('[gidmap]', ...args);}catch(_){} }

  async function authJSON(url, init) {
    // 1) Prefer app's authorized fetch wrapper if present
    if (typeof window.__lm_fetchJSONAuth === 'function') {
      return await window.__lm_fetchJSONAuth(url, { method:'GET', ...(init||{}) });
    }
    // 2) Fallback: use GIS token from gauth.module.js
    let tok = null;
    try {
      const g = await import('./gauth.module.js');
      if (typeof g.getAccessToken === 'function') {
        tok = await g.getAccessToken();
      }
    } catch (e) {
      _warn('gauth import failed', e);
    }
    if (!tok) throw new Error('No auth available for Sheets API');
    const res = await fetch(url, {
      ...(init||{}),
      headers: {
        ...(init && init.headers || {}),
        'Authorization': `Bearer ${tok}`,
        'Accept': 'application/json',
      }
    });
    if (!res.ok) {
      const text = await res.text().catch(()=>'');
      throw new Error(`fetch failed ${res.status} ${text.slice(0,256)}`);
    }
    return await res.json();
  }

  async function fetchSpreadsheetMeta(spreadsheetId) {
    const base = 'https://sheets.googleapis.com/v4/spreadsheets/';
    const fields = 'sheets(properties(sheetId,title,index))';
    const url = `${base}${encodeURIComponent(spreadsheetId)}?fields=${encodeURIComponent(fields)}`;
    return await authJSON(url);
  }

  function buildMap(meta) {
    const byTitle = Object.create(null);
    const byId = Object.create(null);
    const sheets = (meta && meta.sheets) || [];
    for (const s of sheets) {
      const p = s && s.properties || {};
      const title = String(p.title || '');
      const id = Number(p.sheetId);
      const index = Number(p.index || 0);
      if (!title || !Number.isFinite(id)) continue;
      byTitle[title] = { id, index };
      byId[id] = { title, index };
    }
    return { byTitle, byId, fetchedAt: Date.now() };
  }

  async function fetchSheetMap(spreadsheetId, { force = false } = {}) {
    if (!spreadsheetId) throw new Error('spreadsheetId required');
    if (!force && _cache[spreadsheetId]) return _cache[spreadsheetId];
    // small retry/backoff on transient 403/429
    const tries = [0, 250, 750];
    let lastErr = null;
    for (const delay of tries) {
      if (delay) await new Promise(r => setTimeout(r, delay));
      try {
        const meta = await fetchSpreadsheetMeta(spreadsheetId);
        const map = buildMap(meta);
        _cache[spreadsheetId] = map;
        return map;
      } catch (e) {
        lastErr = e;
        // if unauthorized and no wrapper, don't loop forever
        if (String(e.message||'').includes('fetch failed 403')) break;
      }
    }
    throw lastErr || new Error('fetchSheetMap failed');
  }

  function invalidateMap(spreadsheetId) {
    if (spreadsheetId && _cache[spreadsheetId]) {
      delete _cache[spreadsheetId];
      return true;
    }
    return false;
  }

  async function resolveTitleToGid(spreadsheetId, title) {
    const map = await fetchSheetMap(spreadsheetId);
    const hit = map.byTitle[title];
    return hit ? hit.id : null;
  }

  async function resolveGidToTitle(spreadsheetId, gid) {
    const map = await fetchSheetMap(spreadsheetId);
    const hit = map.byId[Number(gid)];
    return hit ? hit.title : null;
  }

  window[NS] = {
    fetchSheetMap,
    resolveTitleToGid,
    resolveGidToTitle,
    invalidateMap,
  };

  _log('ready');
})();
