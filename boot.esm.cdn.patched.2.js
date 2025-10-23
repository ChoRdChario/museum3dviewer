/* boot.esm.cdn.patched.2.js
 * Museum3DViewer overlay (drop-in). No HTML edits needed.
 * Safe auth + Drive/Sheets fixes + writer queue. UI unchanged.
 *
 * How it works:
 *  - Keeps your current UI and boot.esm.cdn.js behavior intact.
 *  - Patches fetch for Google APIs (auth header, URL quirks, 'シート1'→'materials').
 *  - Resolves/creates a Spreadsheet next to the GLB and ensures a 'materials' sheet.
 *  - Queues writes until token & spreadsheetId are ready to prevent 401/no_token/null.
 */
(() => {
  const enc = (s)=>encodeURIComponent(s);

  // ---------- 0) Token ----------
  async function getToken() {
    try {
      const g = await import('./gauth.module.js');
      let t = g.getAccessToken?.();
      t = (t && typeof t.then === 'function') ? await t : t;
      if (!t) throw new Error('no_token');
      return t;
    } catch (e) {
      console.warn('[LM-overlay:getToken] fail', e);
      throw e;
    }
  }

  // ---------- 1) auth JSON fetch ----------
  async function authJSON(url, init = {}) {
    // Respect existing helper if present
    if (typeof window.__lm_fetchJSONAuth === 'function') {
      try { return await window.__lm_fetchJSONAuth(url, init); }
      catch (e) { throw e; }
    }
    const h = new Headers(init.headers || {});
    if (!h.get('Authorization')) {
      h.set('Authorization', 'Bearer ' + await getToken());
    }
    if (!h.get('Content-Type')) h.set('Content-Type', 'application/json');
    const res = await fetch(url, { ...init, headers: h });
    const ct = res.headers.get('content-type') || '';
    const body = ct.includes('json') ? await res.json() : await res.text();
    if (!res.ok) {
      const err = new Error('HTTP ' + res.status);
      err.status = res.status; err.body = body;
      throw err;
    }
    return body;
  }

  // ---------- 2) fetch finalizer (URL/auth fixes) ----------
  if (!window.__lm_overlay_fetch_finalizer) {
    const of = window.fetch;
    window.fetch = async function(input, init = {}) {
      let url = (typeof input === 'string') ? input : (input?.url || '');
      const isGoogle = /https:\/\/(?:www\.)?googleapis\.com\//.test(url);

      if (isGoogle) {
        // Drive files.list malformed params
        if (/https:\/\/www\.googleapis\.com\/drive\/v3\/files\?/.test(url)) {
          url = url
            .replace(/orderBy=modifiedTime(&|$)/, 'orderBy=modifiedTime%20desc$1')
            .replace(/includeItemsFromAllDrives=true%20desc(&|$)/, 'includeItemsFromAllDrives=true$1');
        }
        // Sheets values: 'シート1' → 'materials'
        if (/https:\/\/sheets\.googleapis\.com\/v4\/spreadsheets\/[^/]+\/values\//.test(url)) {
          const SHEET1 = encodeURIComponent("'シート1'");
          const MAT = encodeURIComponent("'materials'");
          url = url.replace(new RegExp(SHEET1, 'g'), MAT)
                   .replace(/%27Sheet1%27/g, MAT);
        }

        // Authorization fix (missing or Promise)
        const headers = new Headers(init?.headers || (typeof input !== 'string' ? input?.headers : undefined) || {});
        const needsAuth = !headers.get('Authorization') || /\[object Promise\]/.test(headers.get('Authorization'));
        if (needsAuth) {
          headers.set('Authorization', 'Bearer ' + await getToken());
          if (!headers.get('Content-Type')) headers.set('Content-Type', 'application/json');
          init = { ...(typeof input === 'string' ? init : { ...input, ...init, headers }), headers };
          input = new Request(url, init);
        } else if (url !== ((typeof input === 'string') ? input : (input?.url || ''))) {
          input = new Request(url, init);
        }
      }

      return of.call(this, input, init);
    };
    window.__lm_overlay_fetch_finalizer = true;
    console.log('[LM-overlay] fetch finalizer installed');
  }

  // ---------- 3) Resolve Spreadsheet next to GLB ----------
  async function getGlbParentId() {
    const raw = (document.getElementById('glbUrl')?.value || location.search || '').trim();
    const glbId = (raw.match(/[A-Za-z0-9_-]{25,}/) || [])[0];
    if (!glbId) return null;
    const parents = await authJSON(`https://www.googleapis.com/drive/v3/files/${glbId}?fields=parents&supportsAllDrives=true`);
    return parents?.parents?.[0] || null;
  }

  async function ensureMaterialsHeader(ssid) {
    const range = enc(`'materials'!A1:K1`);
    const head = await authJSON(`https://sheets.googleapis.com/v4/spreadsheets/${ssid}/values/${range}`).catch(()=>null);
    const ok = !!(head && head.values && head.values[0] && head.values[0].length >= 2);
    if (ok) return;
    // Create sheet (ignore error if it exists)
    await authJSON(`https://sheets.googleapis.com/v4/spreadsheets/${ssid}:batchUpdate`, {
      method:'POST', body: JSON.stringify({ requests: [{ addSheet:{ properties:{ title:'materials' } } }] })
    }).catch(()=>{});
    // Header row
    await authJSON(`https://sheets.googleapis.com/v4/spreadsheets/${ssid}/values/${range}?valueInputOption=RAW`, {
      method:'PUT',
      body: JSON.stringify({ values: [[
        'id','name','mat','unlit','doubleSided','opacity','alphaTest','color','metal','rough','note'
      ]] })
    });
    console.log('[LM-overlay] materials header ensured', ssid);
  }

  async function isLociMyuSheet(ssid) {
    try {
      const r = await authJSON(
        `https://sheets.googleapis.com/v4/spreadsheets/${ssid}?includeGridData=true&` +
        `ranges=${enc('A1:K1')}&fields=sheets(properties(title),data(rowData(values(formattedValue))))`
      );
      const first = (r?.sheets?.[0]?.data?.[0]?.rowData?.[0]?.values || []).map(v => v.formattedValue || '');
      const joined = first.join(',').toLowerCase();
      return joined.includes('id') && joined.includes('name');
    } catch(e) {
      if (e.status === 404) return false;
      return false;
    }
  }

  async function resolveSpreadsheetIdFromGLB() {
    const parent = await getGlbParentId();
    if (!parent) return null;

    const q = enc(`'${parent}' in parents and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`);
    const list = (await authJSON(
      `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,modifiedTime)` +
      `&orderBy=modifiedTime%20desc&pageSize=10&supportsAllDrives=true&includeItemsFromAllDrives=true`
    )).files || [];

    for (const f of list) {
      if (await isLociMyuSheet(f.id)) {
        await ensureMaterialsHeader(f.id);
        return f.id;
      }
    }

    // Create new → move → ensure header
    const mk = await authJSON(`https://sheets.googleapis.com/v4/spreadsheets`, {
      method:'POST', body: JSON.stringify({ properties:{ title:`LociMyu_${new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')}` } })
    });
    const ssid = mk.spreadsheetId;
    const cur = await authJSON(`https://www.googleapis.com/drive/v3/files/${ssid}?fields=parents&supportsAllDrives=true`);
    const oldParents = (cur.parents || []).join(',');
    await authJSON(
      `https://www.googleapis.com/drive/v3/files/${ssid}?addParents=${enc(parent)}${oldParents?`&removeParents=${enc(oldParents)}`:''}&supportsAllDrives=true`,
      { method:'PATCH', body: JSON.stringify({}) }
    );
    await ensureMaterialsHeader(ssid);
    return ssid;
  }

  async function ensureSpreadsheetId() {
    let ssid = window.currentSpreadsheetId || window.__LM_SSID || null;
    if (!ssid) {
      ssid = await resolveSpreadsheetIdFromGLB();
      if (ssid) {
        window.currentSpreadsheetId = ssid;
        window.__LM_SSID = ssid;
        document.dispatchEvent(new CustomEvent('materials:spreadsheetId', { detail:{ spreadsheetId:ssid }}));
        console.log('[LM-overlay] spreadsheetId resolved', ssid);
      }
    } else {
      await ensureMaterialsHeader(ssid).catch(()=>{});
    }
    return ssid;
  }

  // ---------- 4) ensureAuth wrapper ----------
  if (typeof window.ensureAuth === 'function' && !window.ensureAuth.__lm_overlay_safe) {
    const orig = window.ensureAuth;
    window.ensureAuth = async function(){
      const t = await getToken();
      window.__LM_TOKEN = t;
      document.dispatchEvent(new CustomEvent('materials:authstate', { detail:{ ok:true }}));
      try { return await orig.apply(this, arguments); }
      catch { return t; }
    };
    window.ensureAuth.__lm_overlay_safe = true;
    console.log('[LM-overlay] ensureAuth hardened');
  }

  // ---------- 5) Writer gate (queue until ready) ----------
  function installWriterGate(fnName) {
    const orig = window[fnName];
    if (typeof orig !== 'function' || orig.__lm_overlay_gated) return;

    const queue = [];
    let ready = false;
    let preparing = false;

    async function prep() {
      if (ready || preparing) return;
      preparing = true;
      try {
        await getToken();
        const id = await ensureSpreadsheetId();
        if (!id) throw new Error('ssid_missing');
        ready = true;
        while (queue.length) {
          const { args, resolve, reject } = queue.shift();
          try { resolve(await orig.apply(window, args)); }
          catch (e) { reject(e); }
        }
      } finally { preparing = false; }
    }

    window[fnName] = function(...args) {
      const ssid = window.currentSpreadsheetId || window.__LM_SSID;
      const idArg = args?.[0];
      const needQueue = !ssid || idArg == null || String(idArg) === 'null';
      if (needQueue || !ready) {
        prep();
        return new Promise((resolve, reject) => queue.push({ args, resolve, reject }));
      }
      // Range 'シート1' → 'materials'
      try {
        if (typeof args?.[1] === 'string' && /シート1|%E3%82%B7%E3%83%BC%E3%83%881|%27Sheet1%27/.test(args[1])) {
          args[1] = args[1]
            .replace(/シート1/g, 'materials')
            .replace(/%E3%82%B7%E3%83%BC%E3%83%881/g, encodeURIComponent('materials'))
            .replace(/%27Sheet1%27/g, encodeURIComponent("'materials'"));
        }
      } catch {}
      return orig.apply(this, args);
    };
    window[fnName].__lm_overlay_gated = true;
    console.log(`[LM-overlay] writer gate on ${fnName}`);
  }
  installWriterGate('putValues');
  installWriterGate('appendValues');
  installWriterGate('putRowToSheet'); // safeguard for implementation variations

  // ---------- 6) Warm-up ----------
  (async () => {
    try { await getToken(); } catch {}
    try { await ensureSpreadsheetId(); } catch {}
  })();
})();