
/*
 * boot.esm.cdn.patched.2.js  — drop‑in overlay patch
 * Safe: no UI changes. Load this AFTER boot.esm.cdn.js.
 * Goals:
 *  1) Kill 401s by ensuring Authorization on every googleapis request.
 *  2) Fix Drive files.list URL glitch ( ...includeItemsFromAllDrives=true%20desc ).
 *  3) Respect "GLBと同階層の既存LociMyuシート" before creating a new one.
 *  4) Ensure 'materials' sheet exists with header.
 */

(function(){
  const log = (...a)=>console.log.apply(console, ["%c[LM-overlay]", "color:#5ad", ...a]);

  // --- token helper ---------------------------------------------------------
  async function getToken() {
    try {
      const g = await import('./gauth.module.js');
      let v = g.getAccessToken?.();
      v = (v && typeof v.then === 'function') ? await v : v;
      if (!v) throw new Error('no_token');
      return v;
    } catch(e) {
      console.warn('[LM-overlay:getToken] fail', e);
      throw e;
    }
  }

  // --- auth JSON fetch (uses real token; tolerates existing wrapper) --------
  async function authJSON(url, init={}){
    try {
      if (typeof window.__lm_fetchJSONAuth === 'function') {
        return await window.__lm_fetchJSONAuth(url, init);
      }
    } catch(_) { /* fallthrough */ }
    const h = new Headers(init.headers||{});
    if (!h.get('Authorization')) h.set('Authorization', 'Bearer ' + await getToken());
    if (!h.get('Content-Type')) h.set('Content-Type','application/json');
    const res = await fetch(url, {...init, headers:h});
    const ct = res.headers.get('content-type')||'';
    const body = ct.includes('json') ? await res.json() : await res.text();
    if (!res.ok) { const err = new Error('HTTP '+res.status); err.status = res.status; err.body = body; throw err; }
    return body;
  }

  const enc = (s)=>encodeURIComponent(s);

  // --- Final fetch fixer (Authorization + URL normalize + 'Sheet1'→materials)
  if (!window.__lm_final_fetch_fix) {
    const ofetch = window.fetch;
    window.fetch = async function(input, init={}){
      let url = (typeof input === 'string') ? input : (input?.url || '');
      const isGoogle = /https:\/\/(?:www\.)?googleapis\.com\//.test(url);

      if (isGoogle) {
        // Fix Drive files.list URL corruption
        if (/https:\/\/www\.googleapis\.com\/drive\/v3\/files\?/.test(url)) {
          url = url
            .replace(/orderBy=modifiedTime(&|$)/,'orderBy=modifiedTime%20desc$1')
            .replace(/includeItemsFromAllDrives=true%20desc(&|$)/,'includeItemsFromAllDrives=true$1');
        }
        // Force auth header
        const headers = new Headers(init?.headers || (typeof input !== 'string' ? input?.headers : undefined) || {});
        if (!headers.get('Authorization') || /\[object Promise\]/.test(headers.get('Authorization'))) {
          try {
            headers.set('Authorization', 'Bearer ' + await getToken());
            if (!headers.get('Content-Type')) headers.set('Content-Type','application/json');
            init = { ...(typeof input === 'string' ? init : { ...input, ...init, headers }), headers };
            input = new Request(url, init);
          } catch(e) {
            // leave as is (caller may show "Sign in")
          }
        } else if (url !== ((typeof input === 'string') ? input : input?.url || '')) {
          input = new Request(url, init);
        }
      }
      return ofetch.call(this, input, init);
    };
    window.__lm_final_fetch_fix = true;
    log('fetch finalizer installed');
  }

  // --- Helpers used by spreadsheet resolver --------------------------------
  async function getParentOfCurrentGLB(){
    const raw = (document.getElementById('glbUrl')?.value || location.search || '').trim();
    const glbId = (raw.match(/[A-Za-z0-9_-]{25,}/)||[])[0];
    if (!glbId) return null;
    const meta = await authJSON(`https://www.googleapis.com/drive/v3/files/${glbId}?fields=parents&supportsAllDrives=true`);
    return meta?.parents?.[0] || null;
  }

  async function ensureMaterialsHeader(ssid){
    if (!ssid) return;
    const headerRange = enc(`'materials'!A1:K1`);
    // check header presence
    const r = await authJSON(`https://sheets.googleapis.com/v4/spreadsheets/${ssid}/values/${headerRange}`)
      .catch(()=>null);
    const ok = !!(r && r.values && r.values[0] && r.values[0].length >= 2);
    if (ok) return;
    // add sheet if missing & write header
    await authJSON(`https://sheets.googleapis.com/v4/spreadsheets/${ssid}:batchUpdate`, {
      method:'POST',
      body: JSON.stringify({ requests: [{ addSheet: { properties:{ title:'materials' } } }] })
    }).catch(()=>{});
    await authJSON(`https://sheets.googleapis.com/v4/spreadsheets/${ssid}/values/${headerRange}?valueInputOption=RAW`, {
      method:'PUT',
      body: JSON.stringify({ values: [[
        'id','name','mat','unlit','doubleSided','opacity','alphaTest','color','metal','rough','note'
      ]] })
    });
  }

  async function isLociMyuSpreadsheet(ssid){
    try {
      const r = await authJSON(
        `https://sheets.googleapis.com/v4/spreadsheets/${ssid}?includeGridData=true&`+
        `ranges=${enc('A1:K1')}&fields=sheets(properties(title),data(rowData(values(formattedValue))))`
      );
      const first = (r?.sheets?.[0]?.data?.[0]?.rowData?.[0]?.values||[]).map(v=>v.formattedValue||'');
      const j = first.join(',').toLowerCase();
      return j.includes('id') && j.includes('name');
    } catch(e){ return false; }
  }

  // --- Core: find or create spreadsheet in GLB's parent --------------------
  async function findOrCreateInGLBParent(){
    const parent = await getParentOfCurrentGLB();
    if (!parent) return null;

    // 1) list sibling spreadsheets in that folder
    const q = enc(`'${parent}' in parents and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`);
    const list = (await authJSON(
      `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,modifiedTime)&orderBy=modifiedTime%20desc&supportsAllDrives=true&includeItemsFromAllDrives=true&pageSize=10`
    )).files || [];

    // 2) pick first that looks like LociMyu
    for (const f of list) {
      if (await isLociMyuSpreadsheet(f.id)) return f.id;
    }

    // 3) none → create new one and move to parent
    const mk = await authJSON(`https://sheets.googleapis.com/v4/spreadsheets`, {
      method:'POST',
      body: JSON.stringify({ properties:{ title:`LociMyu_${new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')}` } })
    });
    const ssid = mk.spreadsheetId;

    // move into same parent as GLB
    const cur = await authJSON(`https://www.googleapis.com/drive/v3/files/${ssid}?fields=parents&supportsAllDrives=true`);
    const old = (cur.parents||[]).join(',');
    const mv = `https://www.googleapis.com/drive/v3/files/${ssid}?addParents=${enc(parent)}` +
               (old ? `&removeParents=${enc(old)}` : '') +
               `&supportsAllDrives=true`;
    await authJSON(mv, { method:'PATCH', body: JSON.stringify({}) });
    await ensureMaterialsHeader(ssid);
    return ssid;
  }

  // --- Gentle overrides (non-destructive) ----------------------------------
  // If the app already exposes these, wrap them; otherwise add them.
  (function installOverrides(){
    // 1) spreadsheet checker
    if (typeof window.isLociMyuSpreadsheet === 'function') {
      const orig = window.isLociMyuSpreadsheet;
      window.isLociMyuSpreadsheet = async function(ssid){
        // prefer our auth route (avoids 401), fallback to original
        const ok = await (async ()=>{
          try { return await isLociMyuSpreadsheet(ssid); } catch{ return false; }
        })();
        return ok || await orig.call(this, ssid).catch(()=>false);
      };
    } else {
      window.isLociMyuSpreadsheet = isLociMyuSpreadsheet;
    }

    // 2) main resolver used by boot: findOrCreateLociMyuSpreadsheet
    if (typeof window.findOrCreateLociMyuSpreadsheet === 'function') {
      const orig = window.findOrCreateLociMyuSpreadsheet;
      window.findOrCreateLociMyuSpreadsheet = async function(parentFolderId, token, opts){
        try {
          // If caller knows the parent id, keep their flow but force auth on requests via global fetch fix
          const ssid = await findOrCreateInGLBParent();
          if (ssid) return ssid;
        } catch(e) { /* continue to orig */ }
        return await orig.apply(this, arguments);
      };
    } else {
      window.findOrCreateLociMyuSpreadsheet = async function(){ return await findOrCreateInGLBParent(); };
    }
  })();

  // Expose a tiny helper so other scripts can access the resolved id
  (async () => {
    try {
      const ssid = await findOrCreateInGLBParent();
      if (ssid) {
        window.currentSpreadsheetId = window.currentSpreadsheetId || ssid;
        window.__LM_SSID = window.__LM_SSID || ssid;
        document.dispatchEvent(new CustomEvent('materials:spreadsheetId', { detail:{ spreadsheetId:ssid } }));
      }
    } catch {}
  })();
})();
