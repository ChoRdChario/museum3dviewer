
/*
 * LociMyu boot (ESM/CDN) — rollback-safe full build with Materials module
 * Patch Tag: LM-PATCH-ROLLBACK-BASE-3
 *
 * Scope of this patch (minimal / safe):
 *  1) Ensure a "materials" sheet exists with header
 *  2) Populate Material target dropdown from the actually rendered Three.js scene
 *     - GLOBAL + each "MeshName/MaterialName"
 *     - Scene detection is robust: also hooks WebGLRenderer.render to capture the live scene
 *  3) Save changes with debounced UPSERT (one row per sheetId+materialKey)
 *     - avoids per-change append spam and 429s
 *  4) Emit 'materials:apply' CustomEvent + call window.materialsApplyHook(...) when UI changes
 *
 * This file does NOT modify your app HTML nor existing viewer logic.
 */

(() => {
  const log = (...a) => console.log('[materials]', ...a);
  const warn = (...a) => console.warn('[materials]', ...a);

  // ---- helpers ------------------------------------------------------------
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const nowIso = () => new Date().toISOString();

  const $ = (sel) => document.querySelector(sel);
  const byId = (id) => document.getElementById(id);

  // App-provided helpers (if any)
  async function getToken() {
    if (typeof window.ensureToken === 'function') {
      try { await window.ensureToken(); } catch(e) {}
    }
    if (typeof window.getAccessToken === 'function') {
      try { return await window.getAccessToken(); } catch(e) { return null; }
    }
    return null;
  }

  function getSpreadsheetId() {
    return window.currentSpreadsheetId || window.spreadsheetId || null;
  }

  function getActiveSheetId() {
    // prefer explicit UI select (sheet selector) -> gid, else 0
    const sel = $('nav select, #sheet-select');
    const v = sel && sel.value || '0';
    const n = /^\d+$/.test(String(v)) ? Number(v) : 0;
    return n;
  }

  // --- Scene detection (robust) -------------------------------------------
  function getScene() {
    return (
      window.__LM_renderScene ||
      window.gltfScene ||
      window.scene ||
      (window.viewer && (window.viewer.scene || window.viewer.gltfScene)) ||
      null
    );
  }

  function hookRendererSceneCapture() {
    const THREE = window.THREE;
    if (!THREE || !THREE.WebGLRenderer || !THREE.WebGLRenderer.prototype) {
      return;
    }
    if (THREE.WebGLRenderer.prototype.__lm_render_hooked) return;
    const orig = THREE.WebGLRenderer.prototype.render;
    if (typeof orig !== 'function') return;
    THREE.WebGLRenderer.prototype.render = function(scene, camera) {
      try {
        if (scene && scene.isScene) {
          window.__LM_renderScene = scene;
        }
      } catch(_e) {}
      return orig.apply(this, arguments);
    };
    THREE.WebGLRenderer.prototype.__lm_render_hooked = true;
    log('renderer hook installed');
  }

  // fetch wrapper with auth
  async function gapiFetch(url, init={}) {
    const token = await getToken();
    const headers = Object.assign({}, init.headers||{}, token ? { 'Authorization': `Bearer ${token}` } : {});
    const res = await fetch(url, Object.assign({}, init, { headers }));
    if (!res.ok) {
      const t = await res.text();
      const err = new Error(`${init.method||'GET'} ${res.status} ${res.statusText}\n${t}`);
      err.status = res.status;
      err.body = t;
      throw err;
    }
    return res.json();
  }

  // ---- Google Sheets: ensure & upsert ------------------------------------
  const MATERIALS_SHEET_NAME = 'materials';
  const MATERIALS_HEADER = ['sheetId','materialKey','unlit','doubleSided','opacity','white2alpha','whiteThr','black2alpha','blackThr','updatedAt','updatedBy'];

  async function ensureMaterialsSheet(ssid) {
    // try read header
    try {
      await gapiFetch(`https://sheets.googleapis.com/v4/spreadsheets/${ssid}/values/${encodeURIComponent(MATERIALS_SHEET_NAME)}!A1:K1?majorDimension=ROWS`);
      return; // exists
    } catch(e) {
      // proceed to create
    }
    // create sheet
    try {
      await gapiFetch(`https://sheets.googleapis.com/v4/spreadsheets/${ssid}:batchUpdate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [{ addSheet: { properties: { title: MATERIALS_SHEET_NAME } } }]
        })
      });
    } catch (e) {
      // If already exists, ignore; rate-limit also ignore
      const body = String(e.body||'');
      if (!/already exists/i.test(body) && e.status !== 429) {
        warn('addSheet fail', e.status, body.slice(0,200));
      }
    }
    // write header
    try {
      await gapiFetch(`https://sheets.googleapis.com/v4/spreadsheets/${ssid}/values/${encodeURIComponent(MATERIALS_SHEET_NAME)}!A1:K1?valueInputOption=RAW`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ range: `${MATERIALS_SHEET_NAME}!A1:K1`, majorDimension:'ROWS', values: [MATERIALS_HEADER] })
      });
    } catch(e) {
      if (e.status !== 429) warn('put header fail', e.status);
    }
  }

  async function readAllRows(ssid) {
    try {
      const j = await gapiFetch(`https://sheets.googleapis.com/v4/spreadsheets/${ssid}/values/${encodeURIComponent(MATERIALS_SHEET_NAME)}!A2:K9999?majorDimension=ROWS`);
      return j.values || [];
    } catch(e) {
      return [];
    }
  }

  async function upsertRow(ssid, row) {
    // row: [sheetId, materialKey, unlit, doubleSided, opacity, white2alpha, whiteThr, black2alpha, blackThr, updatedAt, updatedBy]
    const all = await readAllRows(ssid);
    let targetRowIndex = -1;
    for (let i=0;i<all.length;i++) {
      const r = all[i] || [];
      if (String(r[0]) === String(row[0]) && String(r[1]) === String(row[1])) {
        targetRowIndex = i; break;
      }
    }
    if (targetRowIndex >= 0) {
      const excelRow = 2 + targetRowIndex;
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${ssid}/values/${encodeURIComponent(MATERIALS_SHEET_NAME)}!A${excelRow}:K${excelRow}?valueInputOption=RAW`;
      await gapiFetch(url, {
        method:'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ range:`${MATERIALS_SHEET_NAME}!A${excelRow}:K${excelRow}`, majorDimension:'ROWS', values:[row] })
      });
      return 'update';
    } else {
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${ssid}/values/${encodeURIComponent(MATERIALS_SHEET_NAME)}!A2:K9999:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
      await gapiFetch(url, {
        method:'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ range:`${MATERIALS_SHEET_NAME}!A2:K9999`, majorDimension:'ROWS', values:[row] })
      });
      return 'append';
    }
  }

  // ---- UI wiring ----------------------------------------------------------

  function readUI() {
    return {
      materialKey: byId('mat-target')?.value || 'GLOBAL',
      unlit: !!byId('mat-unlit')?.checked,
      doubleSided: !!byId('mat-doubleside')?.checked,
      opacity: Number(byId('mat-opacity')?.value ?? 1),
      white2alpha: !!byId('mat-white2alpha')?.checked,
      whiteThr: Number(byId('mat-white-thr')?.value ?? 0.92),
      black2alpha: !!byId('mat-black2alpha')?.checked,
      blackThr: Number(byId('mat-black-thr')?.value ?? 0.08),
    };
  }

  function debounce(fn, ms) {
    let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  function buildRow(sheetId, key, s) {
    return [
      sheetId, key,
      s.unlit?1:0,
      s.doubleSided?1:0,
      Number.isFinite(s.opacity)?s.opacity:1,
      s.white2alpha?1:0,
      Number.isFinite(s.whiteThr)?s.whiteThr:0.92,
      s.black2alpha?1:0,
      Number.isFinite(s.blackThr)?s.blackThr:0.08,
      nowIso(),
      'unknown'
    ];
  }

  async function saveNow() {
    const ssid = getSpreadsheetId();
    if (!ssid) return;
    const sid = getActiveSheetId();
    const s = readUI();
    try {
      const act = await upsertRow(ssid, buildRow(sid, s.materialKey, s));
      log('saved', {sheetId:sid, materialKey:s.materialKey, action:act});
    } catch(e) {
      warn('save failed', e.status, (e && e.message) ? e.message.slice(0,180) : String(e).slice(0,180));
    }
  }

  const saveLater = debounce(saveNow, 900);

  function bindUI() {
    const ids = ['mat-unlit','mat-doubleside','mat-opacity','mat-white2alpha','mat-white-thr','mat-black2alpha','mat-black-thr','mat-target'];
    ids.forEach(id => {
      const el = byId(id); if (!el) return;
      const evt = (el.tagName === 'INPUT' && (el.type === 'range' || el.type === 'checkbox' || el.type === 'number')) ? 'input' : 'change';
      el.addEventListener(evt, saveLater);
      el.addEventListener('change', () => {
        try {
          const detail = { materialKey: byId('mat-target')?.value || 'GLOBAL', settings: readUI() };
          window.dispatchEvent(new CustomEvent('materials:apply', { detail }));
          if (typeof window.materialsApplyHook === 'function') {
            window.materialsApplyHook(detail);
          }
        } catch(_e) {}
      });
    });
  }

  // ---- populate dropdown from scene --------------------------------------
  function setOptions(keys) {
    const sel = byId('mat-target');
    if (!sel) return;
    const cur = sel.value || 'GLOBAL';
    while (sel.firstChild) sel.removeChild(sel.firstChild);
    const mk = (v, t) => { const o = document.createElement('option'); o.value=v; o.textContent=t; return o; };
    sel.appendChild(mk('GLOBAL', 'GLOBAL — All Meshes'));
    keys.forEach(k => sel.appendChild(mk(k, k)));
    sel.value = (cur === 'GLOBAL' || keys.includes(cur)) ? cur : 'GLOBAL';
  }

  function collectMaterialKeys(scene) {
    const set = new Set();
    try {
      scene.traverse(obj => {
        if (!obj || !obj.isMesh || !obj.material) return;
        const meshName = obj.name || 'Mesh';
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach(m => {
          const matName = (m && m.name) ? m.name : 'Material';
          set.add(`${meshName}/${matName}`);
        });
      });
    } catch(e) {}
    return Array.from(set).sort();
  }

  async function sceneWatcher() {
    hookRendererSceneCapture();
    let lastKeySig = '';
    for (;;) {
      await sleep(700);
      const s = getScene();
      if (!s) continue;
      const keys = collectMaterialKeys(s);
      const sig = keys.join('|');
      if (sig && sig !== lastKeySig) {
        setOptions(keys);
        lastKeySig = sig;
        log('populate ready', { count: keys.length });
      }
    }
  }

  // ---- initial bootstrap --------------------------------------------------
  (async function bootOnce() {
    log('populate overlay ready');
    const ssid = getSpreadsheetId();
    const sid = getActiveSheetId();
    const token = await getToken();
    log('bootOnce');
    log('ids', { spreadsheet: ssid, sheetId: sid, waited: 80, hasToken: !!token });

    if (ssid) await ensureMaterialsSheet(ssid);

    bindUI();
    sceneWatcher();
  })();

})();
