<!-- ただのファイル内容です。コピペして data-layer.adapter.js として保存してください -->
<script>
// ============================================================
// Data Layer Adapter for LociMyu (drop-in, non-destructive)
// - 既存 UI/コードを改変せず、Drive/Sheets 呼び出しを安全化
// - 401 / no_token / null SSID / 'シート1' 書込みなどを吸収
// - GLB と同階層に既存 SS があるか最優先で再利用
// - なければ新規作成→親フォルダへ移動→materials ヘッダ付与
// ============================================================
(() => {
  if (window.__LM_ADAPTER_READY) return; // 二重適用防止

  // ---- ログユーティリティ ----
  const log = (...a) => console.log('%c[LM-Adapter]', 'color:#0a0', ...a);
  const warn = (...a) => console.warn('[LM-Adapter]', ...a);
  const enc = (s) => encodeURIComponent(s);

  // ---- 0) 既存APIのダミーを先に用意（早期呼び出しをキュー化） ----
  const Q = { put: [], append: [], row: [] }; // キュー
  const PLACEHOLDER = Symbol('placeholder');

  // 既に関数が定義済みでも「一時置換」してキュー化
  function installGate(fnName, which) {
    const orig = window[fnName];
    if (orig && orig.__lm_wrapped) return;

    window[fnName] = function(...args) {
      return new Promise((resolve, reject) => {
        Q[which].push({ args, resolve, reject });
        log(`queued ${fnName}`);
      });
    };
    window[fnName].__lm_wrapped = true;
    window[fnName].__lm_orig = orig || PLACEHOLDER;
    log(`gate installed: ${fnName}`);
  }

  installGate('putValues', 'put');
  installGate('appendValues', 'append');
  installGate('putRowToSheet', 'row');

  // 見つからないと起動で失敗する系はここで安全実装を注入
  if (typeof window.isLociMyuSpreadsheet !== 'function') {
    window.isLociMyuSpreadsheet = async function(ssid) {
      try {
        const r = await authJSON(
          `https://sheets.googleapis.com/v4/spreadsheets/${ssid}?includeGridData=true&ranges=${enc('A1:K1')}&fields=sheets(properties(title),data(rowData(values(formattedValue))))`
        );
        const first = (r?.sheets?.[0]?.data?.[0]?.rowData?.[0]?.values || []).map(v => v.formattedValue || '');
        const j = first.join(',').toLowerCase();
        return j.includes('id') && j.includes('name');
      } catch (e) {
        if (e.status === 404) return false;
        warn('isLociMyuSpreadsheet fail', e);
        return false;
      }
    };
  }
  if (typeof window.findOrCreateLociMyuSpreadsheet !== 'function') {
    window.findOrCreateLociMyuSpreadsheet = async function(parentFolderId) {
      return await resolveSpreadsheetIdFromParent(parentFolderId);
    };
  }

  // ---- 1) fetch 最終砦：URL崩れ修正 + Authorization 補填 + 'シート1'矯正 ----
  if (!window.__LM_FETCH_FINAL) {
    const origFetch = window.fetch.bind(window);
    window.fetch = async function(input, init = {}) {
      let url = (typeof input === 'string') ? input : (input?.url || '');
      const isGoogle = /https:\/\/(?:www\.)?googleapis\.com\//.test(url);

      if (isGoogle) {
        // Drive list の orderBy/includeItemsFromAllDrives 崩れを修正
        if (/https:\/\/www\.googleapis\.com\/drive\/v3\/files\?/.test(url)) {
          url = url
            .replace(/orderBy=modifiedTime(&|$)/, 'orderBy=modifiedTime%20desc$1')
            .replace(/includeItemsFromAllDrives=true%20desc(&|$)/, 'includeItemsFromAllDrives=true$1');
        }
        // Sheets values の 'シート1' を 'materials' に矯正
        if (/https:\/\/sheets\.googleapis\.com\/v4\/spreadsheets\/[^/]+\/values\//.test(url)) {
          const SHEET1 = encodeURIComponent("'シート1'");
          const MAT = encodeURIComponent("'materials'");
          url = url.replace(new RegExp(SHEET1, 'g'), MAT).replace(/%27Sheet1%27/g, MAT);
        }

        // Authorization を確実に付与
        const headers = new Headers(init?.headers || (typeof input !== 'string' ? input?.headers : undefined) || {});
        const needsAuth = !headers.get('Authorization') || /\[object Promise\]/.test(headers.get('Authorization'));
        if (needsAuth) {
          try {
            const t = await getToken();
            headers.set('Authorization', 'Bearer ' + t);
            if (!headers.get('Content-Type')) headers.set('Content-Type', 'application/json');
            init = { ...(typeof input === 'string' ? init : { ...input, ...init, headers }), headers };
            input = new Request(url, init);
          } catch (e) {
            // トークン未確保時はそのまま（上位で再試行される前提）
            warn('auth inject failed (no_token yet?)', e);
          }
        } else if (url !== ((typeof input === 'string') ? input : (input?.url || ''))) {
          input = new Request(url, init);
        }
      }
      return origFetch(input, init);
    };
    window.__LM_FETCH_FINAL = true;
    log('fetch finalizer installed');
  }

  // ---- 2) トークン取得（gauth.module.js の getAccessToken を await 解決） ----
  let __tok = null;
  async function getToken() {
    if (__tok) return __tok;
    const g = await import('./gauth.module.js');
    // getAccessToken を優先、なければ setupAuth → 再取得
    if (typeof g.getAccessToken === 'function') {
      const v = g.getAccessToken();
      __tok = (v && typeof v.then === 'function') ? await v : v;
    }
    if (!__tok && typeof g.setupAuth === 'function') {
      await g.setupAuth(); // UI側でサインイン誘導
      const v2 = g.getAccessToken?.();
      __tok = (v2 && typeof v2.then === 'function') ? await v2 : v2;
    }
    if (!__tok) throw new Error('no_token');
    return __tok;
  }

  // ---- 3) 認可付き JSON fetch（既存 __lm_fetchJSONAuth があればそれを優先） ----
  async function authJSON(url, init = {}) {
    if (typeof window.__lm_fetchJSONAuth === 'function') {
      return __lm_fetchJSONAuth(url, init);
    }
    const h = new Headers(init.headers || {});
    if (!h.get('Authorization')) h.set('Authorization', 'Bearer ' + await getToken());
    if (!h.get('Content-Type')) h.set('Content-Type', 'application/json');
    const res = await fetch(url, { ...init, headers: h });
    const ct = res.headers.get('content-type') || '';
    const body = ct.includes('json') ? await res.json() : await res.text();
    if (!res.ok) { const e = new Error('HTTP ' + res.status); e.status = res.status; e.body = body; throw e; }
    return body;
  }

  // ---- 4) GLB → 親フォルダIDを解決 ----
  async function getParentIdFromGLB() {
    const raw = (document.getElementById('glbUrl')?.value || location.search || '').trim();
    const glbId = (raw.match(/[A-Za-z0-9_-]{25,}/) || [])[0];
    if (!glbId) return null;
    const j = await authJSON(`https://www.googleapis.com/drive/v3/files/${glbId}?fields=parents&supportsAllDrives=true`);
    return j?.parents?.[0] || null;
  }

  // ---- 5) 親フォルダから SS（materials ヘッダあり）を探す → なければ作る ----
  async function resolveSpreadsheetIdFromParent(parentFolderId) {
    if (!parentFolderId) return null;

    // 5-1) 同階層の SS を列挙
    const q = enc(`'${parentFolderId}' in parents and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`);
    const list = (await authJSON(
      `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,modifiedTime)&orderBy=modifiedTime%20desc&pageSize=10&supportsAllDrives=true&includeItemsFromAllDrives=true`
    )).files || [];

    // 5-2) materials ヘッダを持つ既存を優先採用
    for (const f of list) {
      try {
        const r = await authJSON(
          `https://sheets.googleapis.com/v4/spreadsheets/${f.id}?includeGridData=true&ranges=${enc('A1:K1')}&fields=sheets(properties(title),data(rowData(values(formattedValue))))`
        );
        const head = (r?.sheets?.[0]?.data?.[0]?.rowData?.[0]?.values || []).map(v => v.formattedValue || '');
        const joined = head.join(',').toLowerCase();
        if (joined.includes('id') && joined.includes('name')) {
          log('reuse spreadsheet', f.id);
          return f.id;
        }
      } catch {}
    }

    // 5-3) なければ作成 → 親へ移動 → materials ヘッダ付与
    const mk = await authJSON(`https://sheets.googleapis.com/v4/spreadsheets`, {
      method: 'POST', body: JSON.stringify({ properties: { title: `LociMyu_${new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')}` } })
    });
    const ssid = mk.spreadsheetId;

    const cur = await authJSON(`https://www.googleapis.com/drive/v3/files/${ssid}?fields=parents&supportsAllDrives=true`);
    const oldParents = (cur.parents || []).join(',');
    await authJSON(
      `https://www.googleapis.com/drive/v3/files/${ssid}?addParents=${enc(parentFolderId)}${oldParents ? `&removeParents=${enc(oldParents)}` : ''}&supportsAllDrives=true`,
      { method: 'PATCH', body: JSON.stringify({}) }
    );

    // materials 確保
    await ensureMaterials(ssid);
    log('created spreadsheet', ssid);
    return ssid;
  }

  async function ensureMaterials(ssid) {
    const head = await authJSON(`https://sheets.googleapis.com/v4/spreadsheets/${ssid}/values/${enc("'materials'!A1:K1")}`)
      .catch(()=>null);
    if (!head || !head.values || !head.values[0] || head.values[0].length < 2) {
      await authJSON(`https://sheets.googleapis.com/v4/spreadsheets/${ssid}:batchUpdate`, {
        method: 'POST',
        body: JSON.stringify({ requests: [{ addSheet: { properties: { title: 'materials' } } }] })
      }).catch(()=>{});
      await authJSON(`https://sheets.googleapis.com/v4/spreadsheets/${ssid}/values/${enc("'materials'!A1:K1")}?valueInputOption=RAW`, {
        method: 'PUT',
        body: JSON.stringify({ values: [['id','name','mat','unlit','doubleSided','opacity','alphaTest','color','metal','rough','note']] })
      });
    }
  }

  // ---- 6) ランタイム初期化：トークン＋SSID 決定 → ライター差替＆キュー吐き出し ----
  let __SSID = null;
  async function initOnce() {
    try {
      await getToken(); // まずはサインイン完了を待つ
      const parent = await getParentIdFromGLB();
      if (!parent) { warn('parent folder not found from GLB'); return; }
      __SSID = await resolveSpreadsheetIdFromParent(parent);
      if (__SSID) {
        window.currentSpreadsheetId = __SSID;
        window.__LM_SSID = __SSID;
        document.dispatchEvent(new CustomEvent('materials:spreadsheetId', { detail: { spreadsheetId: __SSID } }));
      }
      // ライターを実装して差替
      installRealWriters();
      // 溜まったキューを順に吐き出す
      flushQueues();
      window.__LM_ADAPTER_READY = true;
      log('ready: ssid=', __SSID);
    } catch (e) {
      // まだ no_token のケースは、ユーザー手動サインインの後に再試行
      if (String(e).includes('no_token')) {
        warn('waiting for sign-in…');
        window.addEventListener('focus', () => setTimeout(initOnce, 300), { once: true });
      } else {
        warn('initOnce failed', e);
      }
    }
  }

  function installRealWriters() {
    // 既存の putValues/appendValues/putRowToSheet があるなら尊重、無い部分だけ埋める
    const writePut = async (rangeA1, values) => {
      let range = rangeA1 || `'materials'!A2:K9999`;
      if (/シート1|%E3%82%B7%E3%83%BC%E3%83%881|%27Sheet1%27/.test(range)) {
        range = range.replace(/シート1/g,'materials').replace(/%E3%82%B7%E3%83%BC%E3%83%881/g, encodeURIComponent('materials')).replace(/%27Sheet1%27/g, "%27materials%27");
      }
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${__SSID}/values/${enc(range)}?valueInputOption=RAW`;
      const body = JSON.stringify({ values: Array.isArray(values)?.[0] ? values : [values] });
      return await authJSON(url, { method: 'PUT', body });
    };

    const writeAppend = async (rangeA1, values) => {
      let range = rangeA1 || `'materials'!A:K`;
      if (/シート1|%E3%82%B7%E3%83%BC%E3%83%881|%27Sheet1%27/.test(range)) {
        range = range.replace(/シート1/g,'materials').replace(/%E3%82%B7%E3%83%BC%E3%83%881/g, encodeURIComponent('materials')).replace(/%27Sheet1%27/g, "%27materials%27");
      }
      const base = `https://sheets.googleapis.com/v4/spreadsheets/${__SSID}/values/${enc(range)}`;
      const url = `${base}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
      const body = JSON.stringify({ values: Array.isArray(values)?.[0] ? values : [values] });
      return await authJSON(url, { method: 'POST', body });
    };

    // 差替：既存関数が PLACEHOLDER なら上書き。元実装があるならそれを使うが、null/シート1はアダプターが補正。
    function replaceWriter(name, impl, queueKey) {
      const was = window[name];
      if (was && was.__lm_orig && was.__lm_orig === PLACEHOLDER) {
        window[name] = async function(spreadsheetId, rangeA1, values) {
          // 呼び出しシグネチャの差異を吸収
          let range = rangeA1, vals = values;
          if (Array.isArray(spreadsheetId)) { vals = spreadsheetId; range = rangeA1; }
          if (!range) range = `'materials'!A2:K9999`;
          return impl(range, vals);
        };
        window[name].__lm_wrapped = true;
      } else {
        // 元実装がある場合、SSID と range の補正だけかけてから元を呼ぶ
        const orig = was;
        window[name] = async function(spreadsheetId, rangeA1, values) {
          let ssid = spreadsheetId || __SSID || window.currentSpreadsheetId || window.__LM_SSID;
          let range = rangeA1, vals = values;
          if (Array.isArray(spreadsheetId)) { vals = spreadsheetId; range = rangeA1; ssid = __SSID; }
          if (!ssid) ssid = __SSID;
          if (!range) range = `'materials'!A2:K9999`;
          if (/シート1|%E3%82%B7%E3%83%BC%E3%83%881|%27Sheet1%27/.test(range)) {
            range = range.replace(/シート1/g,'materials').replace(/%E3%82%B7%E3%83%BC%E3%83%881/g, encodeURIComponent('materials')).replace(/%27Sheet1%27/g, "%27materials%27");
          }
          return orig.call(this, ssid, range, vals);
        };
        window[name].__lm_wrapped = true;
      }
      log(`writer ready: ${name}`);
    }

    replaceWriter('putValues', writePut, 'put');
    replaceWriter('appendValues', writeAppend, 'append');

    // putRowToSheet が values.* を内部で呼ぶなら、そのままでOK。直接実装する保険も置く。
    if (window.putRowToSheet && window.putRowToSheet.__lm_orig === PLACEHOLDER) {
      window.putRowToSheet = async function(rangeA1, values) {
        return writePut(rangeA1 || `'materials'!A2:K9999`, values);
      };
      window.putRowToSheet.__lm_wrapped = true;
      log('writer ready: putRowToSheet');
    }
  }

  async function flushQueues() {
    // put → append → row の順で吐き出す（大きな意味はないが可読性のため）
    for (const { args, resolve, reject } of Q.put.splice(0)) {
      try { resolve(await window.putValues.apply(window, args)); } catch (e) { reject(e); }
    }
    for (const { args, resolve, reject } of Q.append.splice(0)) {
      try { resolve(await window.appendValues.apply(window, args)); } catch (e) { reject(e); }
    }
    for (const { args, resolve, reject } of Q.row.splice(0)) {
      try { resolve(await window.putRowToSheet.apply(window, args)); } catch (e) { reject(e); }
    }
  }

  // ---- 7) 起動（ユーザーがサインイン後でも必ず再試行される） ----
  // すぐ走らせつつ、no_token の場合は focus 後に再試行
  initOnce();
  window.__LM_ADAPTER_BOOT = initOnce;

})();
</script>
