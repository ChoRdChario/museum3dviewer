/*! LociMyu runtime overlay fix (safe, non-destructive)
 *  - Fixes Drive list URL corruption (double "desc" and param ordering)
 *  - Ensures all googleapis requests have a real Bearer token (no [object Promise])
 *  - Resolves spreadsheetId before any write; dispatches 'materials:spreadsheetId' event
 *  - Creates new Sheet via Sheets API then moves with Drive files.update (avoids files.create 401)
 *  - Ensures 'materials' sheet and header; rewrites 'シート1' ranges to 'materials'
 *  Load this file *after* boot.esm.cdn.js
 */
(()=>{
  const enc = s => encodeURIComponent(s);

  // --- Token (always awaited) ---
  async function getToken() {
    try {
      const g = await import('./gauth.module.js');
      let v = g.getAccessToken?.();
      v = (v && typeof v.then === 'function') ? await v : v;
      if (!v) throw new Error('no_token');
      return v;
    } catch (e) {
      const err = new Error('no_token'); err.cause = e; throw err;
    }
  }

  // --- Authorized JSON fetch (prefer existing wrapper) ---
  async function authJSON(url, init={}) {
    if (typeof window.__lm_fetchJSONAuth === 'function') return __lm_fetchJSONAuth(url, init);
    const headers = new Headers(init.headers||{});
    if (!headers.get('Authorization')) headers.set('Authorization', 'Bearer ' + await getToken());
    if (!headers.get('Content-Type')) headers.set('Content-Type', 'application/json');
    const res = await fetch(url, {...init, headers});
    const ct = res.headers.get('content-type') || '';
    const body = ct.includes('json') ? await res.json() : await res.text();
    if (!res.ok) { const e = new Error('HTTP '+res.status); e.status=res.status; e.body=body; throw e; }
    return body;
  }

  // --- Ensure materials sheet with header ---
  async function ensureMaterials(ssid){
    if (!ssid) return;
    // Try to read header; if missing create + header
    const range = enc(`'materials'!A1:K1`);
    const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${ssid}/values/${range}`);
    if (r.status === 200) return;
    await authJSON(`https://sheets.googleapis.com/v4/spreadsheets/${ssid}:batchUpdate`, {
      method:'POST', body: JSON.stringify({ requests:[{ addSheet:{ properties:{ title:'materials' } } }] })
    }).catch(()=>{});
    await authJSON(`https://sheets.googleapis.com/v4/spreadsheets/${ssid}/values/${range}?valueInputOption=RAW`, {
      method:'PUT', body: JSON.stringify({ values:[['id','name','mat','unlit','doubleSided','opacity','alphaTest','color','metal','rough','note']] })
    });
  }

  // --- Resolve spreadsheetId from the GLB sibling (list→check→create→move) ---
  async function resolveSpreadsheetIdFromGLB() {
    // Try current global
    if (window.currentSpreadsheetId || window.__LM_SSID) return window.currentSpreadsheetId || window.__LM_SSID;

    // Extract glbId from UI
    const raw = (document.getElementById('glbUrl')?.value || location.search || '').trim();
    const glbId = (raw.match(/[A-Za-z0-9_-]{25,}/) || [])[0];
    if (!glbId) return null;

    // Get parent folder
    const parent = (await authJSON(`https://www.googleapis.com/drive/v3/files/${glbId}?fields=parents&supportsAllDrives=true`)).parents?.[0];
    if (!parent) return null;

    // List spreadsheets in same folder (AllDrives)
    const q = enc(`'${parent}' in parents and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`);
    const listUrl = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,modifiedTime)&orderBy=modifiedTime%20desc&pageSize=10&supportsAllDrives=true&includeItemsFromAllDrives=true`;
    const files = (await authJSON(listUrl)).files || [];

    // Pick one with materials header
    for (const f of files) {
      try {
        const r = await authJSON(
          `https://sheets.googleapis.com/v4/spreadsheets/${f.id}?includeGridData=true&ranges=${enc('A1:K1')}&fields=sheets(properties(title),data(rowData(values(formattedValue))))`
        );
        const first = (r?.sheets?.[0]?.data?.[0]?.rowData?.[0]?.values || []).map(v => v.formattedValue || '');
        const s = first.join(',').toLowerCase();
        if (s.includes('id') && s.includes('name')) return f.id;
      } catch {}
    }

    // Create spreadsheet via Sheets API
    const mk = await authJSON(`https://sheets.googleapis.com/v4/spreadsheets`, {
      method:'POST', body: JSON.stringify({ properties:{ title:`LociMyu_${new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')}` } })
    });
    const ssid = mk.spreadsheetId;

    // Move to parent via Drive files.update (not files.create)
    const cur = await authJSON(`https://www.googleapis.com/drive/v3/files/${ssid}?fields=parents&supportsAllDrives=true`);
    const oldParents = (cur.parents||[]).join(',');
    const mvUrl = `https://www.googleapis.com/drive/v3/files/${ssid}?addParents=${enc(parent)}${oldParents?`&removeParents=${enc(oldParents)}`:''}&supportsAllDrives=true`;
    await authJSON(mvUrl, { method:'PATCH', body: JSON.stringify({}) });

    // Ensure materials and header
    await ensureMaterials(ssid);
    return ssid;
  }

  // --- Fix: global fetch finalizer (URL normalize + token patch + range rewrite) ---
  if (!window.__LM_FETCH_FINALIZER__) {
    const ofetch = window.fetch;
    window.fetch = async function(input, init={}) {
      let url = (typeof input === 'string') ? input : (input?.url || '');
      const isGoogle = /https:\/\/(?:www\.)?googleapis\.com\//.test(url);

      if (isGoogle) {
        // Fix Drive list corruption
        if (/https:\/\/www\.googleapis\.com\/drive\/v3\/files\?/.test(url)) {
          url = url
            .replace(/orderBy=modifiedTime(&|$)/, 'orderBy=modifiedTime%20desc$1')    // ensure desc once
            .replace(/orderBy=modifiedTime%20desc%20desc/g, 'orderBy=modifiedTime%20desc') // remove double desc
            .replace(/includeItemsFromAllDrives=true%20desc(&|$)/, 'includeItemsFromAllDrives=true$1'); // detach stray desc
        }
        // Rewrite 'シート1' → 'materials' (for Sheets values endpoint)
        if (/https:\/\/sheets\.googleapis\.com\/v4\/spreadsheets\/[^/]+\/values\//.test(url)) {
          const SHEET1 = encodeURIComponent("'シート1'");  // ja
          const SHEET1_EN = "%27Sheet1%27";               // en
          const MAT = encodeURIComponent("'materials'");
          url = url.replace(new RegExp(SHEET1, 'g'), MAT).replace(new RegExp(SHEET1_EN,'g'), MAT);
        }

        // Patch Authorization if missing or Promise-like
        const headers = new Headers(init?.headers || (typeof input !== 'string' ? input?.headers : undefined) || {});
        const needsAuth = !headers.get('Authorization') || /\[object Promise\]/.test(headers.get('Authorization'));
        if (needsAuth) {
          headers.set('Authorization', 'Bearer ' + await getToken());
          if (!headers.get('Content-Type')) headers.set('Content-Type', 'application/json');
          init = { ...(typeof input === 'string' ? init : { ...input, ...init, headers }), headers };
        }
        if (url !== ((typeof input === 'string') ? input : (input?.url || ''))) {
          input = new Request(url, init);
        }
      }
      return ofetch.call(this, input, init);
    };
    window.__LM_FETCH_FINALIZER__ = true;
    console.log('[overlay] fetch finalizer installed');
  }

  // --- Gate sheet writes until ssid & token are ready ---
  function installWriterGate(fnName) {
    const orig = window[fnName];
    if (typeof orig !== 'function' || orig.__gated) return;

    const queue = [];
    let ready = false, prepping = false;

    async function prepare() {
      if (ready || prepping) return;
      prepping = true;
      try {
        await getToken();
        let ssid = window.currentSpreadsheetId || window.__LM_SSID;
        if (!ssid) {
          ssid = await resolveSpreadsheetIdFromGLB();
          if (ssid) {
            window.currentSpreadsheetId = ssid;
            window.__LM_SSID = ssid;
            document.dispatchEvent(new CustomEvent('materials:spreadsheetId', { detail:{ spreadsheetId:ssid } }));
          }
        }
        if (ssid) await ensureMaterials(ssid);
        ready = true;
        while (queue.length) {
          const {args,resolve,reject} = queue.shift();
          try { resolve(await orig.apply(window, args)); }
          catch(e){ reject(e); }
        }
      } finally { prepping = false; }
    }

    window[fnName] = function(...args){
      const ssid = window.currentSpreadsheetId || window.__LM_SSID;
      if (!ssid || args?.[0]==null || String(args?.[0])==='null') {
        prepare(); // async
        return new Promise((resolve,reject)=>queue.push({args,resolve,reject}));
      }
      try {
        if (typeof args?.[1] === 'string') {
          args[1] = args[1]
            .replace(/シート1/g,'materials')
            .replace(/%E3%82%B7%E3%83%BC%E3%83%881/g, encodeURIComponent('materials'))
            .replace(/%27Sheet1%27/g, encodeURIComponent("'materials'"));
        }
      } catch {}
      return orig.apply(this, args);
    };
    window[fnName].__gated = true;
    console.log(`[overlay] writer gate on ${fnName}`);
  }

  installWriterGate('putValues');
  installWriterGate('appendValues');
  installWriterGate('putRowToSheet');

  // --- Ensure ssid early (best-effort) ---
  resolveSpreadsheetIdFromGLB().then(async (ssid)=>{
    if (!ssid) return;
    window.currentSpreadsheetId = window.currentSpreadsheetId || ssid;
    window.__LM_SSID = window.__LM_SSID || ssid;
    await ensureMaterials(ssid);
    document.dispatchEvent(new CustomEvent('materials:spreadsheetId', { detail:{ spreadsheetId:ssid } }));
    console.log('[overlay] spreadsheetId ready →', ssid);
  }).catch(()=>{});

})();