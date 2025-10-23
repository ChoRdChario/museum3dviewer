/* LociMyu runtime overlay fix (self-contained)
 * Drop-in replacement for boot.esm.cdn.js OR load after it.
 * - Ensures Google API calls always include a real OAuth token
 * - Repairs malformed Drive list URLs
 * - Redirects Sheets 'シート1' / 'Sheet1' ranges to 'materials'
 * - Resolves spreadsheetId from GLB parent (find-or-create)
 * - Prevents writes to /spreadsheets/null by auto-fixing to the resolved SS
 * Non-destructive: does not remove existing features; only wraps.
 */

(function(){
  const LOG_PREFIX = '[LM-overlay]';
  const enc = (s)=>encodeURIComponent(s);

  // ---------- Token helpers ----------
  async function getToken() {
    try {
      const g = await import('./gauth.module.js');
      let t = g.getAccessToken?.();
      t = (t && typeof t.then === 'function') ? await t : t;
      if (!t) throw new Error('no_token');
      // cache a bit
      window.__LM_TOKEN = t;
      return t;
    } catch (e) {
      console.warn(LOG_PREFIX, 'getToken failed', e);
      throw e;
    }
  }

  async function authJSON(url, init={}) {
    // Respect existing app wrapper if present
    if (typeof window.__lm_fetchJSONAuth === 'function') {
      return window.__lm_fetchJSONAuth(url, init);
    }
    const headers = new Headers(init.headers||{});
    if (!headers.get('Authorization') || /\[object Promise\]/.test(headers.get('Authorization'))) {
      headers.set('Authorization', 'Bearer ' + await getToken());
    }
    if (!headers.get('Content-Type')) headers.set('Content-Type','application/json');
    const res = await fetch(url, {...init, headers});
    const ct = res.headers.get('content-type')||'';
    const body = ct.includes('json') ? await res.json() : await res.text();
    if (!res.ok) { const err = new Error('HTTP '+res.status); err.status = res.status; err.body = body; throw err; }
    return body;
  }

  // ---------- Spreadsheet resolver ----------
  async function getGlbParentId() {
    const raw = (document.getElementById('glbUrl')?.value || location.search || '').trim();
    const glbId = (raw.match(/[A-Za-z0-9_-]{25,}/)||[])[0];
    if (!glbId) return null;
    try {
      const j = await authJSON(`https://www.googleapis.com/drive/v3/files/${glbId}?fields=parents&supportsAllDrives=true`);
      return j?.parents?.[0] || null;
    } catch (e) {
      console.warn(LOG_PREFIX, 'getGlbParentId failed', e);
      return null;
    }
  }

  async function hasMaterialsHeader(ssid){
    try {
      const r = await authJSON(
        `https://sheets.googleapis.com/v4/spreadsheets/${ssid}?includeGridData=true`+
        `&ranges=${enc('A1:K1')}`+
        `&fields=sheets(properties(title),data(rowData(values(formattedValue))))`
      );
      const first = (r?.sheets?.[0]?.data?.[0]?.rowData?.[0]?.values||[]).map(v=>v.formattedValue||'');
      const j = first.join(',').toLowerCase();
      return j.includes('id') && j.includes('name');
    } catch(e) {
      return false;
    }
  }

  async function ensureMaterialsSheet(ssid){
    try{
      // header exists?
      const head = await authJSON(`https://sheets.googleapis.com/v4/spreadsheets/${ssid}/values/${enc("'materials'!A1:K1")}`)
        .catch(()=>null);
      if (head && head.values && head.values[0] && head.values[0].length>=2) return;
      // add sheet (ignore if exists)
      await authJSON(`https://sheets.googleapis.com/v4/spreadsheets/${ssid}:batchUpdate`, {
        method:'POST',
        body: JSON.stringify({ requests:[{ addSheet:{ properties:{ title:'materials' } } }] })
      }).catch(()=>{});
      // header row
      await authJSON(`https://sheets.googleapis.com/v4/spreadsheets/${ssid}/values/${enc("'materials'!A1:K1")}?valueInputOption=RAW`, {
        method:'PUT',
        body: JSON.stringify({ values:[['id','name','mat','unlit','doubleSided','opacity','alphaTest','color','metal','rough','note']] })
      });
    }catch(e){
      console.warn(LOG_PREFIX, 'ensureMaterialsSheet warn', e);
    }
  }

  async function resolveSpreadsheetId() {
    if (window.__LM_SSID || window.currentSpreadsheetId) return window.__LM_SSID || window.currentSpreadsheetId;
    const parent = await getGlbParentId();
    if (!parent) return null;

    // list siblings
    const q = enc(`'${parent}' in parents and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`);
    const list = (await authJSON(
      `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,modifiedTime)&orderBy=modifiedTime%20desc&pageSize=10&supportsAllDrives=true&includeItemsFromAllDrives=true`
    )).files || [];

    for (const f of list) {
      if (await hasMaterialsHeader(f.id)) {
        window.__LM_SSID = f.id;
        window.currentSpreadsheetId = f.id;
        document.dispatchEvent(new CustomEvent('materials:spreadsheetId', { detail:{ spreadsheetId:f.id }}));
        return f.id;
      }
    }
    // create new
    const mk = await authJSON(`https://sheets.googleapis.com/v4/spreadsheets`, {
      method:'POST', body: JSON.stringify({ properties:{ title:`LociMyu_${new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')}` } })
    });
    const ssid = mk.spreadsheetId;
    // move to parent
    const cur = await authJSON(`https://www.googleapis.com/drive/v3/files/${ssid}?fields=parents&supportsAllDrives=true`);
    const oldParents = (cur.parents||[]).join(',');
    await authJSON(
      `https://www.googleapis.com/drive/v3/files/${ssid}?addParents=${enc(parent)}${oldParents?`&removeParents=${enc(oldParents)}`:''}&supportsAllDrives=true`,
      { method:'PATCH', body: JSON.stringify({}) }
    );
    await ensureMaterialsSheet(ssid);
    window.__LM_SSID = ssid;
    window.currentSpreadsheetId = ssid;
    document.dispatchEvent(new CustomEvent('materials:spreadsheetId', { detail:{ spreadsheetId:ssid }}));
    return ssid;
  }

  // ---------- Fetch finalizer ----------
  if (!window.__LM_FETCH_FINALIZER_INSTALLED) {
    const origFetch = window.fetch;
    window.fetch = async function(input, init = {}) {
      let url = (typeof input === 'string') ? input : (input?.url || '');
      const isGoogle = /https:\/\/(?:www\.)?googleapis\.com\//.test(url);

      // Repairs and redirects
      if (isGoogle) {
        // Fix Drive list URL glitches
        if (/https:\/\/www\.googleapis\.com\/drive\/v3\/files\?/.test(url)) {
          url = url
            .replace(/orderBy=modifiedTime(&|$)/, 'orderBy=modifiedTime%20desc$1')
            .replace(/%20desc%20desc/g, '%20desc')
            .replace(/includeItemsFromAllDrives=true%20desc(&|$)/, 'includeItemsFromAllDrives=true$1');
        }

        // Sheets: redirect "Sheet1/シート1" to 'materials'
        if (/https:\/\/sheets\.googleapis\.com\/v4\/spreadsheets\/[^/]+\/values\//.test(url)) {
          const MAT = enc("'materials'");
          const SHEET1_JA = enc("'シート1'");
          const SHEET1_EN = "%27Sheet1%27"; // already encoded
          url = url.replace(new RegExp(SHEET1_JA,'g'), MAT).replace(new RegExp(SHEET1_EN,'g'), MAT);
        }

        // Fix /spreadsheets/null/ by resolving id
        if (/https:\/\/sheets\.googleapis\.com\/v4\/spreadsheets\/null\//.test(url)) {
          const ssid = await resolveSpreadsheetId();
          if (ssid) {
            url = url.replace('/spreadsheets/null/','/spreadsheets/'+ssid+'/');
          }
        }
      }

      // Ensure Authorization header is a real token
      const headers = new Headers(init?.headers || (typeof input !== 'string' ? input?.headers : undefined) || {});
      if (isGoogle) {
        const needsAuth = !headers.get('Authorization') || /\[object Promise\]/.test(headers.get('Authorization'));
        if (needsAuth) {
          try {
            const tok = window.__LM_TOKEN || await getToken();
            headers.set('Authorization', 'Bearer ' + tok);
          } catch (e) {
            // fall through; request may still fail, but we tried
          }
        }
        if (!headers.get('Content-Type')) headers.set('Content-Type','application/json');
      }

      // Always rebuild Request if url or headers changed
      const rebuilt = new Request(url, { ...(typeof input === 'string' ? init : input), ...init, headers });
      return origFetch.call(this, rebuilt);
    };
    window.__LM_FETCH_FINALIZER_INSTALLED = true;
    console.log(LOG_PREFIX, 'fetch finalizer installed');
  }

  // ---------- Proactively resolve SS (avoid initial null) ----------
  (async () => {
    try {
      await resolveSpreadsheetId();
      // Ensure header exists for safety
      if (window.__LM_SSID) await ensureMaterialsSheet(window.__LM_SSID);
    } catch (e) {
      // non-fatal
    }
  })();

  // ---------- Optional: hide extra scrollbars in side panel ----------
  try {
    const style = document.createElement('style');
    style.textContent = `
      /* soften nested scrollbars without breaking page scroll */
      .loci-panel, .side, .right-panel { overscroll-behavior: contain; }
      .loci-panel .scroll, .panel .scroll { scrollbar-gutter: stable both-edges; }
    `;
    document.head.appendChild(style);
  } catch {}

})();