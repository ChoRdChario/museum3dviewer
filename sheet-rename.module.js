  // ---- Sheet Name Registry (v1) ----
  // Avoid per-sheet Z1 batchGet (A1-notation encoding pitfalls). Store display names in a dedicated sheet.
  const SHEET_NAME_REGISTRY_TITLE = '__LM_SHEET_NAMES';
  const SHEET_NAME_REGISTRY_HEADER = ['sheetGid', 'displayName', 'sheetTitle', 'updatedAt'];
/*! sheet-rename.module.js — v3 (display-name via Z1, gid-first, __lm_fetchJSONAuth) */
(function () {
  function isShareMode() {
    return !!(window.__LM_IS_SHARE_MODE || window.__LM_IS_VIEW_MODE || (window.__LM_MODE && window.__LM_MODE.isShareMode));
  }

  const DEBUG =
    /\bdebug=1\b/.test(location.search) || window.SHEET_RENAME_DEBUG;
  const log = (...a) => {
    if (DEBUG) console.log("[renameUI]", ...a);
  };
  const warn = (...a) => {
    if (DEBUG) console.warn("[renameUI]", ...a);
  };

  // --- small helpers ---------------------------------------------------
  function $(id) {
    return document.getElementById(id);
  }

  function findSheetSelect() {
    return (
      $("save-target-sheet") ||
      $("sheet-select") ||
      document.querySelector(
        "#save-target-sheet select, #sheet-select select, .lm-panel-caption select, #captions select, .right-panel select"
      ) ||
      null
    );
  }

  function ensureWrapperForSelect(sel) {
    if (!sel || !sel.parentNode) return null;
    let host =
      $("save-target-sheet-wrapper") || $("sheet-select-wrapper");
    if (host) return host;
    host = document.createElement("div");
    host.id =
      sel.id === "save-target-sheet"
        ? "save-target-sheet-wrapper"
        : "sheet-select-wrapper";
    host.style.display = "flex";
    host.style.alignItems = "center";
    host.style.gap = "4px";
    sel.parentNode.insertBefore(host, sel);
    host.appendChild(sel);
    return host;
  }

  function listSheetsFromDOM(sel) {
    const out = [];
    if (!sel) return out;
    for (const opt of Array.from(sel.options || [])) {
      const id = opt.value ? Number(opt.value) : null;
      out.push({ sheetId: id, title: (opt.textContent || "").trim() });
    }
    return out;
  }

  function updateOptionTextAndDataset(opt, title) {
    if (!opt) return;
    opt.textContent = title;
    if (!opt.dataset) opt.dataset = {};
    // dataset.title は「UI上の名前」（表示名）として扱う
    opt.dataset.title = title;
  }

  // --- view state ------------------------------------------------------
  function updateSheetRenameView(mode) {
    const rootEl = $("sheet-rename-root");
    const wrapperEl = rootEl && rootEl.parentElement;
    if (wrapperEl && wrapperEl.classList) {
      wrapperEl.classList.toggle("is-renaming", mode === "edit");
      wrapperEl.classList.toggle("is-busy", mode === "busy");
    }

    const label = $("sheet-rename-label");
    const input = $("sheet-rename-input");
    const ok = $("sheet-rename-ok");
    const cancel = $("sheet-rename-cancel");
    const edit = $("sheet-rename-edit");
    const spin = $("sheet-rename-spin");
    if (!input || !ok || !cancel || !edit || !spin) return;

    const title = (window.currentSheetTitle || "").trim();

    if (mode === "edit") {
      if (label) label.style.display = "none";
      input.style.display = "inline-block";
      ok.style.display = "inline-block";
      cancel.style.display = "inline-block";
      edit.style.display = "none";
      spin.style.display = "none";
      input.value = title || "";
      input.focus();
      input.select();
    } else if (mode === "busy") {
      if (label) label.style.display = "none";
      input.style.display = "none";
      ok.style.display = "none";
      cancel.style.display = "none";
      edit.style.display = "none";
      spin.style.display = "inline-block";
    } else {
      // view モードでもラベルは表示しない（ドロップダウン側の表示を優先）
      if (label) label.style.display = "none";
      input.style.display = "none";
      ok.style.display = "none";
      cancel.style.display = "none";
      edit.style.display = "inline-block";
      spin.style.display = "none";
      // label.textContent = title || "(no sheet)"; // hidden anyway
    }
  }

  function wireSelectChange() {
    const sel = findSheetSelect();
    if (!sel) return;
    const syncFromSelect = () => {
      const opt =
        (sel.selectedOptions && sel.selectedOptions[0]) ||
        sel.options[sel.selectedIndex] ||
        null;
      const title =
        opt && opt.textContent ? opt.textContent.trim() : "";
      const id = opt && opt.value ? Number(opt.value) : null;

      if (id != null && !Number.isNaN(id)) {
        window.currentSheetId = id;
      } else {
        window.currentSheetId = null;
      }
      if (title) window.currentSheetTitle = title;

      sel.title = title || "";

      const label = $("sheet-rename-label");
      const edit = $("sheet-rename-edit");
      if (label) label.textContent = title || "(no sheet)";
      if (edit) edit.disabled = !(window.currentSheetId != null);
    };

    syncFromSelect();
    sel.addEventListener("change", syncFromSelect, { passive: true });
    new MutationObserver(syncFromSelect).observe(sel, {
      childList: true,
      subtree: true,
    });
  }

  // --- auth helper (unified with A系) ----------------------------------
  async function getAuthFetchAndToken() {
    // 1) __lm_fetchJSONAuth があればそれを最優先（token 内部取得）
    if (typeof window.__lm_fetchJSONAuth === "function") {
      return { authFetch: window.__lm_fetchJSONAuth, token: null };
    }

    // 2) 旧来の ensureToken + getAccessToken で token を取る
    let token = null;

    // silent
    try {
      if (typeof window.ensureToken === "function") {
        await window.ensureToken({ interactive: false });
      }
      if (typeof window.getAccessToken === "function") {
        token = await window.getAccessToken();
      }
    } catch (_) {}

    // interactive
    if (!token) {
      try {
        if (typeof window.ensureToken === "function") {
          await window.ensureToken({ interactive: true });
        }
        if (typeof window.getAccessToken === "function") {
          token = await window.getAccessToken();
        }
      } catch (_) {}
    }

    if (!token) {
      throw new Error("no token");
    }

    const authFetch = async (url, init) => {
      const headers = Object.assign(
        {},
        (init && init.headers) || {},
        {
          Authorization: "Bearer " + token,
          Accept: "application/json",
        }
      );
      if (init && init.body && !headers["Content-Type"]) {
        headers["Content-Type"] = "application/json";
      }
      const res = await fetch(url, Object.assign({}, init, { headers }));
      if (!res.ok) {
        const text = await res.text().catch(() => res.statusText);
        throw new Error(`Sheets API ${res.status}: ${text}`);
      }
      try {
        return await res.json();
      } catch {
        return null;
      }
    };

    return { authFetch, token };
  }

  // --- Sheets helper: display-name via Z1 -------------------------------
  const SHEETS_ROOT = "https://sheets.googleapis.com/v4/spreadsheets";

  function isSystemSheetTitle(title) {
    return /^__LM_/i.test(String(title || ""));
  }

  function quoteSheetTitle(title) {
    // Always quote sheet titles for robust A1 notation (unicode / spaces / symbols).
    // Inside single quotes, single quote must be doubled.
    const t = String(title || "").replace(/'/g, "''");
    return `'${t}'`;
  }

    async function fetchSheetProps(spreadsheetId) {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets(properties(sheetId,title))`;
    const data = await __lm_fetchJSONAuth(url);
    const sheets = data?.sheets || [];
    return sheets.map(s => ({
      sheetId: String(s?.properties?.sheetId ?? ''),
      title: String(s?.properties?.title ?? '')
    })).filter(s => s.sheetId && s.title);
  }

  async function findSheetByTitle(spreadsheetId, title){
    const props = await fetchSheetProps(spreadsheetId);
    return props.find(s => s.title === String(title || '')) || null;
  }


  async function ensureSheetNameRegistrySheet(spreadsheetId) {
  if (!spreadsheetId) return null;
  const exist = await findSheetByTitle(spreadsheetId, REGISTRY_SHEET_TITLE);
  if (exist) return exist;
  if (isShareMode()) {
    return null;
  }

    const props = await fetchSheetProps(spreadsheetId);
    const found = props.find(s => s.title === SHEET_NAME_REGISTRY_TITLE);
    if (!found) {
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`;
      const payload = { requests: [{ addSheet: { properties: { title: SHEET_NAME_REGISTRY_TITLE } } }] };
      await __lm_fetchJSONAuth(url, { method: 'POST', body: JSON.stringify(payload) });
    }
    await ensureRegistryHeader(spreadsheetId);
  }

  async function ensureRegistryHeader(spreadsheetId) {
    const headerRange = `${SHEET_NAME_REGISTRY_TITLE}!A1:D1`;
    const getUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(headerRange)}`;
    let current = null;
    try {
      const got = await __lm_fetchJSONAuth(getUrl);
      current = got?.values?.[0] || null;
    } catch (e) {
      // ignore - we'll attempt to write header
    }
    const want = SHEET_NAME_REGISTRY_HEADER;
    const same = Array.isArray(current) && current.length >= want.length && want.every((v, i) => String(current[i] ?? '') === v);
    if (same) return;

    const putUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(headerRange)}?valueInputOption=RAW`;
    const payload = { range: headerRange, majorDimension: 'ROWS', values: [want] };
    await __lm_fetchJSONAuth(putUrl, { method: 'PUT', body: JSON.stringify(payload) });
  }

  async function readSheetNameRegistry(spreadsheetId) {
    await ensureSheetNameRegistrySheet(spreadsheetId);
    const rowsRange = `${SHEET_NAME_REGISTRY_TITLE}!A2:D`;
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(rowsRange)}`;
    const data = await __lm_fetchJSONAuth(url);
    const rows = data?.values || [];
    const gidToDisplayName = new Map();
    const gidToSheetTitle = new Map();
    const gidToRowNumber = new Map(); // 1-based row number in sheet
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i] || [];
      const gid = String(r[0] ?? '').trim();
      if (!gid) continue;
      const displayName = String(r[1] ?? '').trim();
      const sheetTitle = String(r[2] ?? '').trim();
      if (displayName) gidToDisplayName.set(gid, displayName);
      if (sheetTitle) gidToSheetTitle.set(gid, sheetTitle);
      gidToRowNumber.set(gid, 2 + i);
    }
    return { gidToDisplayName, gidToSheetTitle, gidToRowNumber };
  }

  async function upsertSheetNameRegistry(spreadsheetId, sheetGid, displayName, sheetTitle) {
    await ensureSheetNameRegistrySheet(spreadsheetId);
    const gid = String(sheetGid ?? '').trim();
    if (!gid) return;
    const now = new Date().toISOString();
    const { gidToRowNumber } = await readSheetNameRegistry(spreadsheetId);
    const rowNo = gidToRowNumber.get(gid);

    if (rowNo) {
      const range = `${SHEET_NAME_REGISTRY_TITLE}!A${rowNo}:D${rowNo}`;
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`;
      const values = [[gid, String(displayName ?? ''), String(sheetTitle ?? ''), now]];
      await __lm_fetchJSONAuth(url, { method: 'PUT', body: JSON.stringify({ range, majorDimension: 'ROWS', values }) });
      return;
    }

    const appendRange = `${SHEET_NAME_REGISTRY_TITLE}!A:D`;
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(appendRange)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
    const values = [[gid, String(displayName ?? ''), String(sheetTitle ?? ''), now]];
    await __lm_fetchJSONAuth(url, { method: 'POST', body: JSON.stringify({ range: appendRange, majorDimension: 'ROWS', values }) });
  }

  async function appendSheetNameRegistryRows(spreadsheetId, rows) {
    if (!Array.isArray(rows) || rows.length === 0) return;
    await ensureSheetNameRegistrySheet(spreadsheetId);
    const appendRange = `${SHEET_NAME_REGISTRY_TITLE}!A:D`;
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(appendRange)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
    await __lm_fetchJSONAuth(url, { method: 'POST', body: JSON.stringify({ range: appendRange, majorDimension: 'ROWS', values: rows }) });
  }



function encodeA1ForUrl(a1) {
    // encodeURIComponent leaves some characters unescaped (e.g. ' ! ( ) *).
    // Sheets API accepts percent-encoded forms; we fully encode these for safety.
    return encodeURIComponent(a1).replace(/[!'()*]/g, (c) =>
      "%" + c.charCodeAt(0).toString(16).toUpperCase()
    );
  }

  function buildRange(sheetTitle, a1) {
    // Always quote to be safe across unicode / spaces / punctuation.
    const title = quoteSheetTitle(sheetTitle);
    return `${title}!${a1}`;
  }

  // Z1 に表示名を書き込む
  async function sheetsPutDisplayName(
    spreadsheetId,
    sheetId,
    newTitle,
    authFetch,
    token
  ) {
    const NS = window.LM_SHEET_GIDMAP;
    if (!NS || typeof NS.fetchSheetMap !== "function") {
      throw new Error("LM_SHEET_GIDMAP not available");
    }
    const map = await NS.fetchSheetMap(spreadsheetId);
    const byId = map && map.byId;
    const meta = byId && byId[Number(sheetId)];
    const sheetTitle = meta && meta.title;
    if (!sheetTitle) {
      throw new Error("sheet title not found for gid " + sheetId);
    }

    const range = buildRange(sheetTitle, "Z1");
    const url =
      SHEETS_ROOT +
      "/" +
      encodeURIComponent(spreadsheetId) +
      "/values/" +
      encodeA1ForUrl(range) +
      "?valueInputOption=RAW";

    const body = {
      values: [[newTitle]],
    };

    if (typeof authFetch === "function") {
      return authFetch(url, {
        method: "PUT",
        body: JSON.stringify(body),
      });
    }

    // 念のためのフォールバック
    const headers = {
      Accept: "application/json",
      "Content-Type": "application/json",
    };
    if (token) headers["Authorization"] = "Bearer " + token;
    const res = await fetch(url, {
      method: "PUT",
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`Sheets API ${res.status}: ${text}`);
    }
    try {
      return await res.json();
    } catch {
      return null;
    }
  }

  // Z1 から表示名を一括で読み、ドロップダウンに反映
  // spreadsheetIdOverride / selectElOverride は、他モジュールが <select> を再構築した直後に
  // 再同期させたいケース向け。
      async function syncDisplayNamesFromZ1(spreadsheetId, sheets, selectEl) {
    // NOTE: legacy name kept for compatibility. We now read from the registry sheet to avoid Z1 batchGet.
    try {
      const { gidToDisplayName, gidToRowNumber } = await readSheetNameRegistry(spreadsheetId);

      // Seed missing entries in one shot (best-effort), so the registry becomes complete over time.
      if (Array.isArray(sheets)) {
        const now = new Date().toISOString();
        const toAppend = [];
        for (const s of sheets) {
          const gid = String(s?.gid ?? '').trim();
          const title = String(s?.title ?? '').trim();
          if (!gid || !title) continue;
          if (isSystemSheetTitle(title)) continue;
          if (gidToRowNumber.has(gid)) continue;
          toAppend.push([gid, title, title, now]);
          gidToDisplayName.set(gid, title);
        }
        if (toAppend.length) {
          try { await appendSheetNameRegistryRows(spreadsheetId, toAppend); } catch (e) { /* ignore */ }
        }
      }

      let updated = 0;
      const opts = Array.from(selectEl?.options || []);
      for (const opt of opts) {
        const gid = String(opt?.value ?? '').trim();
        if (!gid) continue;
        const displayName = gidToDisplayName.get(gid);
        if (!displayName) continue;
        if (opt.textContent !== displayName) {
          opt.textContent = displayName;
          updated++;
        }
        opt.dataset.displayName = displayName;
      }
      console.log('[sheet-rename] display names synced from registry', { updated, total: opts.length });
    } catch (err) {
      console.warn('[sheet-rename] registry sync failed (leaving sheet titles as-is)', err);
    }
  }





async function sheetsUpdateTitle(
    spreadsheetId,
    sheetId,
    newTitle,
    authFetch,
    token
  ) {
    // 互換性のために残しているが、現在は呼び出さない
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      spreadsheetId
    )}:batchUpdate`;
    const body = {
      requests: [
        {
          updateSheetProperties: {
            properties: {
              sheetId: Number(sheetId),
              title: newTitle,
            },
            fields: "title",
          },
        },
      ],
    };

    if (typeof authFetch === "function") {
      return authFetch(url, {
        method: "POST",
        body: JSON.stringify(body),
      });
    }

    const headers = {
      Accept: "application/json",
      "Content-Type": "application/json",
    };
    if (token) headers["Authorization"] = "Bearer " + token;
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`Sheets API ${res.status}: ${text}`);
    }
    try {
      return await res.json();
    } catch {
      return null;
    }
  }

  // --- applySheetRename (Z1 display-name版) -----------------------------
  async function applySheetRename() {
    const input = $("sheet-rename-input");
    const spin = $("sheet-rename-spin");
    const ok = $("sheet-rename-ok");
    const cancel = $("sheet-rename-cancel");
    const label = $("sheet-rename-label");
    const sel = findSheetSelect();
    if (!input || !spin || !ok || !cancel || !label || !sel) return;

    if (window.currentSheetId == null) {
      wireSelectChange();
      if (window.currentSheetId == null) return;
    }

    const before = window.currentSheetTitle || "";
    const newTitle = (input.value || "").trim();
    const opt = sel.querySelector(
      `option[value="${window.currentSheetId}"]`
    );

    // 不正 or 変更なし or 長すぎる → 何もしない
    if (!newTitle || newTitle === before || newTitle.length > 100) {
      updateSheetRenameView("view");
      return;
    }

    // 表示名としての重複チェック（実シート名とは無関係）
    for (const o of Array.from(sel.options || [])) {
      if ((o.textContent || "").trim() === newTitle) {
        updateSheetRenameView("view");
        return;
      }
    }

    // 楽観的 UI 更新
    label.textContent = newTitle;
    if (opt) updateOptionTextAndDataset(opt, newTitle);
    window.currentSheetTitle = newTitle;
    updateSheetRenameView("view");

    // spreadsheetId を __LM_ACTIVE_SPREADSHEET_ID 優先で取得
    let spreadsheetId =
      window.__LM_ACTIVE_SPREADSHEET_ID ||
      window.currentSpreadsheetId ||
      "";

    // ctx.bridge が少し遅れるケースに備えて短時間だけ待つ
    if (!spreadsheetId) {
      for (let t = 0; t < 5 && !spreadsheetId; t++) {
        await new Promise((r) => setTimeout(r, 60));
        spreadsheetId =
          window.__LM_ACTIVE_SPREADSHEET_ID ||
          window.currentSpreadsheetId ||
          "";
      }
    }

    if (!spreadsheetId) {
      // 失敗したらロールバック
      label.textContent = before;
      if (opt) updateOptionTextAndDataset(opt, before);
      window.currentSheetTitle = before;
      warn("rename failed", new Error("spreadsheetId missing"));
      return;
    }

    // API 呼び出し (Z1 書き込み)
    try {
      input.disabled = ok.disabled = cancel.disabled = true;
      spin.style.display = "inline-block";

      const { authFetch, token } = await getAuthFetchAndToken();
      await sheetsPutDisplayName(
        spreadsheetId,
        window.currentSheetId,
        newTitle,
        authFetch,
        token
      );

      // 成功時は currentSheetTitle / option は既に newTitle になっているので何もしない
      log("rename success (Z1 display-name)", newTitle);
    } catch (e) {
      // 失敗したらロールバック
      label.textContent = before;
      if (opt) updateOptionTextAndDataset(opt, before);
      window.currentSheetTitle = before;
      warn("rename failed", e);
    } finally {
      input.disabled = ok.disabled = cancel.disabled = false;
      spin.style.display = "none";
    }
  }

  // --- UI events -------------------------------------------------------
  function wireSheetRenameEvents() {
    const label = $("sheet-rename-label");
    const input = $("sheet-rename-input");
    const ok = $("sheet-rename-ok");
    const cancel = $("sheet-rename-cancel");
    const edit = $("sheet-rename-edit");

    if (!label || !input || !ok || !cancel || !edit) return;

    edit.addEventListener(
      "click",
      () => {
        if (!(window.currentSheetId != null)) return;
        updateSheetRenameView("edit");
      },
      { passive: true }
    );

    label.addEventListener(
      "click",
      () => {
        if (!(window.currentSheetId != null)) return;
        updateSheetRenameView("edit");
      },
      { passive: true }
    );

    cancel.addEventListener(
      "click",
      () => {
        updateSheetRenameView("view");
      },
      { passive: true }
    );

    ok.addEventListener(
      "click",
      () => {
        applySheetRename();
      },
      { passive: true }
    );

    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        applySheetRename();
      } else if (ev.key === "Escape") {
        ev.preventDefault();
        updateSheetRenameView("view");
      }
    });
  }

  // --- UI mount --------------------------------------------------------
  function mountSheetRenameUI() {
    const sel = findSheetSelect();
    if (!sel || !sel.parentNode) return false;

    const host = ensureWrapperForSelect(sel);
    if (!host) return false;
    if ($("sheet-rename-root")) return true;

    const root = document.createElement("div");
    root.id = "sheet-rename-root";
    root.className = "sheet-rename-ui";
    root.style.display = "inline-flex";
    root.style.alignItems = "center";
    root.style.gap = "4px";
    root.style.flex = "1 1 auto";
    root.innerHTML = [
      '<button id="sheet-rename-edit" class="sr-btn sr-edit" type="button" title="Rename sheet">✎</button>',
      '<span id="sheet-rename-label" class="sr-label">(no sheet)</span>',
      '<input id="sheet-rename-input" class="sr-input" type="text" style="display:none;">',
      '<button id="sheet-rename-ok" class="sr-btn sr-ok" type="button" title="Apply" style="display:none;">✓</button>',
      '<button id="sheet-rename-cancel" class="sr-btn sr-cancel" type="button" title="Cancel" style="display:none;">×</button>',
      '<span id="sheet-rename-spin" class="sr-spin" aria-hidden="true" style="display:none;">⏳</span>',
    ].join("");

    host.appendChild(root);
    wireSheetRenameEvents();
    wireSelectChange();
    updateSheetRenameView("view");
    // シート一覧と gid→title のマップが揃った後、Z1 から表示名を同期
    // ※このUIの自動マウントは、save.locatorやselectorより先に走ることがあるため
    // ここでは「分かる範囲で」同期を試みる（確実な同期は selector 側からも呼ぶ）。
    try {
      const ctx = window.__lm_ctx || {};
      const spreadsheetId = ctx.spreadsheetId;
      const sel = document.getElementById("sheetSelect");
      const authFetch = window.__lm_fetchJSONAuth || window.__lm_fetchJSON;
      if (spreadsheetId && sel && typeof authFetch === "function") {
        syncDisplayNamesFromZ1(spreadsheetId, authFetch, sel);
      }
    } catch (e) {
      console.warn("[sheet-rename] sync attempt skipped", e);
    }
    log("UI mounted");
    return true;
  }

  // --- auto-mount ------------------------------------------------------
  (function autoMount() {
    if (mountSheetRenameUI()) return;
    const mo = new MutationObserver(() => {
      if (mountSheetRenameUI()) mo.disconnect();
    });
    mo.observe(document.documentElement || document.body, {
      childList: true,
      subtree: true,
    });
    let tries = 30;
    const tm = setInterval(() => {
      if (mountSheetRenameUI() || --tries <= 0) clearInterval(tm);
    }, 200);
  })();

  // expose helpers for classic scripts (non-module)
  // caption.sheet.selector.js expects this name.
  window.__lm_syncSheetDisplayNamesFromZ1 = async function (spreadsheetId, a, b) {
    // supported signatures:
    //   (spreadsheetId, selectEl)
    //   (spreadsheetId, authFetch, selectEl)
    let authFetch = null;
    let selectEl = null;

    if (a && typeof a === "function") {
      authFetch = a;
      selectEl = b;
    } else {
      selectEl = a;
      authFetch = window.__lm_fetchJSONAuth || window.__lm_fetchJSON;
    }

    return syncDisplayNamesFromZ1(spreadsheetId, authFetch, selectEl);
  };

  // for manual debugging
  window.__lm_applySheetRename = applySheetRename;


  // optional export for manual re-mount
  window.mountSheetRenameUI = mountSheetRenameUI;
})();