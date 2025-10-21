/* LociMyu Materials Standalone Module (rev FIX-RANGE-AND-ENSURE)
   - No renames or HTML edits required.
   - Places/updates a 'materials' sheet and saves UI changes with debounce.
   - Uses Sheets REST directly (no wrapper GV/PV/AV) to avoid quoting bugs.
*/
(() => {
  const SHEET_NAME = 'materials';
  const HEADER = [
    'sheetId','materialKey',
    'unlit','doubleSided','opacity',
    'white2alpha','whiteThr','black2alpha','blackThr',
    'updatedAt','updatedBy'
  ];

  // ---------- small utils
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const nowIso = () => new Date().toISOString();
  const log = (...a) => console.log('[materials.mod]', ...a);
  const warn = (...a) => console.warn('[materials.mod]', ...a);

  // ---------- discover spreadsheet id & gid
  function detectSpreadsheetId() {
    const g = window;
    return (
      g.currentSpreadsheetId ||
      g.spreadsheetId ||
      g.__ssid ||
      localStorage.getItem('lm:ssid') ||
      null
    );
  }
  function detectActiveGid() {
    const g = window;
    const cand = [
      g.currentSheetId, g.activeSheetId, g.sheetId, g.currentGid, g.currentSheetGid
    ].find(v => (typeof v === 'number' && isFinite(v)) || (typeof v === 'string' && /^\d+$/.test(v)));
    if (cand != null) return Number(cand);
    try {
      const sel = document.querySelector('nav select, #sheet-select, select[name="sheet"], select[data-role="sheet"]');
      if (sel && /^\d+$/.test(sel.value)) return Number(sel.value);
    } catch {}
    return 0;
  }

  // ---------- token
  async function getToken() {
    if (typeof window.ensureToken === 'function') {
      try { await window.ensureToken(); } catch {}
    }
    if (typeof window.getAccessToken === 'function') {
      try {
        const t = await window.getAccessToken();
        if (t && typeof t === 'string') return t;
      } catch {}
    }
    // fallback: if any global token is exposed (not recommended; dev only)
    if (window.__accessToken && typeof window.__accessToken === 'string') return window.__accessToken;
    return null;
  }

  // ---------- Google Sheets REST thin wrappers
  async function gfetch(path, init, token) {
    const url = `https://sheets.googleapis.com/v4/${path}`;
    const hdr = Object.assign({}, init?.headers || {}, {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json; charset=UTF-8'
    });
    const res = await fetch(url, Object.assign({}, init, { headers: hdr }));
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`${init?.method||'GET'} ${path} ${res.status} ${txt}`);
    }
    return res.json();
  }

  async function ensureMaterialsSheet(spreadsheetId, token) {
    // 1) try to read header; if 200 and header matches, ok
    try {
      const j = await gfetch(
        `spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(SHEET_NAME)}!A1:K1?majorDimension=ROWS`,
        { method:'GET' }, token
      );
      const got = (j.values && j.values[0]) || [];
      if (HEADER.every((h,i)=> got[i] === h)) {
        log('header ok');
        return;
      }
      // header exists but not matching -> put header
    } catch (e) {
      // maybe sheet missing -> addSheet
      if (String(e).includes('404') || String(e).includes('Unable to parse range')) {
        try {
          await gfetch(
            `spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`,
            { method:'POST', body: JSON.stringify({
              requests: [{ addSheet: { properties: { title: SHEET_NAME } } }]
            }) }, token
          );
          log('sheet created');
        } catch (ee) {
          // if already exists (race), ignore
          if (!String(ee).includes('already exists')) throw ee;
        }
      } else {
        throw e;
      }
    }
    // 2) PUT header
    await gfetch(
      `spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(SHEET_NAME)}!A1:K1?valueInputOption=RAW`,
      { method:'PUT', body: JSON.stringify({ range:`${SHEET_NAME}!A1:K1`, values:[HEADER] }) },
      token
    );
    log('header ensured');
  }

  // upsert by (sheetId, materialKey)
  async function upsertRow(spreadsheetId, token, row) {
    // fetch all keys in a light way to find row index (2..)
    const read = await gfetch(
      `spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(SHEET_NAME)}!A2:B9999?majorDimension=ROWS`,
      { method:'GET' }, token
    );
    const rows = read.values || [];
    let idx = -1;
    for (let i=0;i<rows.length;i++) {
      const a = rows[i]||[];
      if (String(a[0])===String(row[0]) && String(a[1])===String(row[1])) { idx = i+2; break; }
    }
    if (idx === -1) {
      // append
      await gfetch(
        `spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(SHEET_NAME)}!A2:K9999:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
        { method:'POST', body: JSON.stringify({ values: [row] }) }, token
      );
      log('append ok', row[0], row[1]);
    } else {
      // update
      await gfetch(
        `spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(SHEET_NAME)}!A${idx}:K${idx}?valueInputOption=RAW`,
        { method:'PUT', body: JSON.stringify({ values: [row] }) }, token
      );
      log('update ok @', idx, row[0], row[1]);
    }
  }

  // --------- scene apply (safe)
  const getScene = () => window.gltfScene || window.scene || (window.viewer && (window.viewer.scene || window.viewer.gltfScene)) || null;
  function applyToScene(materialKey, s) {
    const THREE = window.THREE;
    const scene = getScene();
    if (!THREE || !scene) return;
    const swapToBasic = (mesh) => {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const out = [];
      mats.forEach((m,i)=>{
        mesh.userData._origMat = mesh.userData._origMat || {};
        if (!mesh.userData._origMat[i]) mesh.userData._origMat[i] = m;
        const basic = new THREE.MeshBasicMaterial({
          map: m.map ?? null, color: m.color ?? undefined,
          transparent: true, opacity: ('opacity' in m ? m.opacity : 1),
          side: m.side ?? THREE.FrontSide, alphaTest: m.alphaTest ?? 0
        });
        out.push(basic);
      });
      mesh.material = Array.isArray(mesh.material) ? out : out[0];
    };
    const restore = (mesh) => {
      const orig = mesh.userData && mesh.userData._origMat;
      if (!orig) return;
      mesh.material = Array.isArray(mesh.material) ? Object.keys(orig).map(k => orig[k]) : (orig[0] ?? mesh.material);
    };

    scene.traverse(obj => {
      if (!obj?.isMesh || !obj.material) return;
      let target = true;
      if (materialKey && materialKey !== 'GLOBAL') {
        const meshName = obj.name || 'Mesh';
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        target = mats.some(m => `${meshName}/${(m?.name||'Material')}` === materialKey);
      }
      if (!target) return;
      if (s.unlit) swapToBasic(obj); else restore(obj);
      (Array.isArray(obj.material) ? obj.material : [obj.material]).forEach(m => {
        if (!m) return;
        m.side = s.doubleSided ? THREE.DoubleSide : THREE.FrontSide;
        m.transparent = s.opacity < 1 || m.transparent;
        m.opacity = (typeof s.opacity === 'number') ? s.opacity : 1;
        if (s.white2alpha || s.black2alpha) {
          const thr = Math.max(0, Math.min(0.5, (s.white2alpha ? s.whiteThr : s.blackThr)));
          m.alphaTest = thr;
        } else m.alphaTest = 0;
        m.needsUpdate = true;
      });
    });
    try { window.viewer?.renderNow?.(); } catch {}
  }

  // --------- UI wiring
  const readUI = () => ({
    materialKey: document.getElementById('mat-target')?.value || 'GLOBAL',
    unlit: !!document.getElementById('mat-unlit')?.checked,
    doubleSided: !!document.getElementById('mat-doubleside')?.checked,
    opacity: Number(document.getElementById('mat-opacity')?.value ?? 1),
    white2alpha: !!document.getElementById('mat-white2alpha')?.checked,
    whiteThr: Number(document.getElementById('mat-white-thr')?.value ?? 0.92),
    black2alpha: !!document.getElementById('mat-black2alpha')?.checked,
    blackThr: Number(document.getElementById('mat-black-thr')?.value ?? 0.08),
  });

  let saveTimer = null;
  async function onChange() {
    // gate: need ssid + token
    const spreadsheetId = detectSpreadsheetId();
    const token = await getToken();
    if (!spreadsheetId || !token) {
      warn('blocked: spreadsheetId or token not ready', { spreadsheetId, hasToken: !!token });
      return;
    }
    // ensure sheet + header (with simple backoff)
    let ok = false, wait = 400;
    for (let i=0;i<4 && !ok;i++) {
      try { await ensureMaterialsSheet(spreadsheetId, token); ok = true; }
      catch(e){ warn('ensure failed (retry)', e); await sleep(wait); wait*=2; }
    }
    if (!ok) return;

    const s = readUI();
    const row = [
      detectActiveGid(), s.materialKey,
      s.unlit?1:0, s.doubleSided?1:0, Number.isFinite(s.opacity)?s.opacity:1,
      s.white2alpha?1:0, Number.isFinite(s.whiteThr)?s.whiteThr:0.92,
      s.black2alpha?1:0, Number.isFinite(s.blackThr)?s.blackThr:0.08,
      nowIso(), (window.__userEmail || 'unknown')
    ];

    try {
      await upsertRow(spreadsheetId, token, row);
      applyToScene(s.materialKey, s);
    } catch (e) {
      warn('save failed', e);
    }
  }

  function wireUI() {
    const ids = ['mat-unlit','mat-doubleside','mat-opacity','mat-white2alpha','mat-white-thr','mat-black2alpha','mat-black-thr','mat-target'];
    ids.forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      const ev = (el.tagName === 'SELECT') ? 'change' : 'input';
      el.addEventListener(ev, () => {
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(onChange, 400);
      });
    });
  }

  // boot
  function boot() {
    wireUI();
    // Try initial apply (won't save until user changes)
    try { const s = readUI(); applyToScene(s.materialKey, s); } catch {}
    log('ready');
  }

  // Wait DOM
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
