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


  // --- shared state for select wiring ---------------------------------
  let __sr_lastSelect = null;
  let __sr_selectMO = null;
  let __sr_domMO = null;

  function syncCurrentFromSelect(sel) {
    sel = sel || findSheetSelect();
    if (!sel) return;

    const opt =
      (sel.selectedOptions && sel.selectedOptions[0]) ||
      sel.options[sel.selectedIndex] ||
      null;

    const gidStr = opt && opt.value != null ? String(opt.value).trim() : "";
    const gidNum = gidStr ? Number(gidStr) : NaN;

    const displayName = opt ? String(opt.textContent || "").trim() : "";
    const sheetTitle =
      opt && opt.dataset && opt.dataset.sheetTitle
        ? String(opt.dataset.sheetTitle).trim()
        : displayName;

    window.currentSheetId = Number.isFinite(gidNum) ? gidNum : null;
    window.currentSheetDisplayName = displayName;
    window.currentSheetTitle = sheetTitle;

    // Tooltip: show displayName (not necessarily the actual sheet title).
    sel.title = displayName || "";

    const edit = $("sheet-rename-edit");
    if (edit) edit.disabled = !(window.currentSheetId != null);
    const label = $("sheet-rename-label");
    if (label) label.textContent = window.currentSheetDisplayName || "(no sheet)";
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

    const title = (window.currentSheetDisplayName || window.currentSheetTitle || "").trim();

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

    // If the <select> node got replaced, rewire against the latest node.
    if (__sr_lastSelect !== sel) {
      __sr_lastSelect = sel;
      // Stop observing the previous select.
      try { if (__sr_selectMO) __sr_selectMO.disconnect(); } catch (_) {}
      __sr_selectMO = null;
    }

    // Bind once per select node.
    if (!sel.__lm_sheet_rename_wired) {
      sel.__lm_sheet_rename_wired = true;

      sel.addEventListener(
        "change",
        () => {
          syncCurrentFromSelect(sel);
        },
        { passive: true }
      );

      // Options are rebuilt dynamically; keep globals in sync.
      __sr_selectMO = new MutationObserver(() => {
        syncCurrentFromSelect(sel);
      });
      __sr_selectMO.observe(sel, { childList: true, subtree: true });
    }

    // Ensure a DOM watcher exists so we can recover if other modules rebuild the selector.
    if (!__sr_domMO) {
      __sr_domMO = new MutationObserver(() => {
        const latest = findSheetSelect();
        if (latest && latest !== __sr_lastSelect) {
          // Rewire and (if needed) move the rename UI next to the new selector.
          mountSheetRenameUI();
        }
      });
      __sr_domMO.observe(document.documentElement || document.body, { childList: true, subtree: true });
    }

    syncCurrentFromSelect(sel);
  }

  // --- auth helper ----------------------------------------------------
  // (unified with A系) ----------------------------------
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
    return props.find(s => s.title === title) || null;
  }

  async function ensureSheetNameRegistrySheet(spreadsheetId) {
  if (!spreadsheetId) return null;

  // 1) Fast path: find by title (cached metadata)
  const exist = await findSheetByTitle(spreadsheetId, SHEET_NAME_REGISTRY_TITLE);
  if (exist) return exist;

  // 2) Check the spreadsheet metadata once (covers cases where findSheetByTitle is stale)
  let props = [];
  try {
    props = await fetchSheetProps(spreadsheetId);
  } catch (_) {
    props = [];
  }
  const found = props.find((s) => s && s.title === SHEET_NAME_REGISTRY_TITLE);
  if (found) return found;

  // 3) Share mode must never create sheets.
  if (isShareMode()) return null;

  // 4) Create the registry sheet, then ensure header.
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`;
  const payload = {
    requests: [
      { addSheet: { properties: { title: SHEET_NAME_REGISTRY_TITLE } } },
    ],
  };
  await __lm_fetchJSONAuth(url, { method: "POST", body: JSON.stringify(payload) });
  await ensureRegistryHeader(spreadsheetId);

  // 5) Return the newly created sheet props (best-effort).
  try {
    props = await fetchSheetProps(spreadsheetId);
  } catch (_) {
    props = [];
  }
  return props.find((s) => s && s.title === SHEET_NAME_REGISTRY_TITLE) || { title: SHEET_NAME_REGISTRY_TITLE };
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

    // Ensure we have a current selection (some modules rebuild the <select>).
    syncCurrentFromSelect(sel);
    if (window.currentSheetId == null) return;

    const opt = sel.querySelector(`option[value="${window.currentSheetId}"]`);
    const beforeDisplayName =
      (window.currentSheetDisplayName || (opt && opt.textContent) || "").trim();
    const sheetTitle =
      (opt && opt.dataset && opt.dataset.sheetTitle)
        ? String(opt.dataset.sheetTitle).trim()
        : (window.currentSheetTitle || beforeDisplayName);

    const newDisplayName = (input.value || "").trim();

    // invalid / unchanged / too long → no-op
    if (!newDisplayName || newDisplayName === beforeDisplayName || newDisplayName.length > 100) {
      updateSheetRenameView("view");
      return;
    }

    // Duplicate check (UI labels must be unique)
    for (const o of Array.from(sel.options || [])) {
      if ((o.textContent || "").trim() === newDisplayName) {
        updateSheetRenameView("view");
        return;
      }
    }

    // optimistic UI update
    label.textContent = newDisplayName;
    if (opt) updateOptionTextAndDataset(opt, newDisplayName);
    window.currentSheetDisplayName = newDisplayName;
    updateSheetRenameView("view");

    // spreadsheetId: prefer __LM_ACTIVE_SPREADSHEET_ID
    let spreadsheetId =
      window.__LM_ACTIVE_SPREADSHEET_ID ||
      window.currentSpreadsheetId ||
      (window.__lm_ctx && window.__lm_ctx.spreadsheetId) ||
      "";

    // ctx.bridge may lag; wait briefly
    if (!spreadsheetId) {
      for (let t = 0; t < 5 && !spreadsheetId; t++) {
        await new Promise((r) => setTimeout(r, 60));
        spreadsheetId =
          window.__LM_ACTIVE_SPREADSHEET_ID ||
          window.currentSpreadsheetId ||
          (window.__lm_ctx && window.__lm_ctx.spreadsheetId) ||
          "";
      }
    }

    if (!spreadsheetId) {
      // rollback
      label.textContent = beforeDisplayName || "(no sheet)";
      if (opt) updateOptionTextAndDataset(opt, beforeDisplayName);
      window.currentSheetDisplayName = beforeDisplayName;
      warn("rename failed", new Error("spreadsheetId missing"));
      return;
    }

    // Share mode must not write.
    if (String(window.__LM_MODE || "").toLowerCase() === "share") {
      label.textContent = beforeDisplayName || "(no sheet)";
      if (opt) updateOptionTextAndDataset(opt, beforeDisplayName);
      window.currentSheetDisplayName = beforeDisplayName;
      warn("rename blocked in share mode");
      return;
    }

    // API call: write to __LM_SHEET_NAMES registry (not per-sheet Z1).
    try {
      input.disabled = ok.disabled = cancel.disabled = true;
      spin.style.display = "inline-block";

      await upsertSheetNameRegistry(
        spreadsheetId,
        window.currentSheetId,
        newDisplayName,
        sheetTitle
      );

      log("rename success (registry)", { sheetGid: window.currentSheetId, displayName: newDisplayName });
    } catch (e) {
      // rollback
      label.textContent = beforeDisplayName || "(no sheet)";
      if (opt) updateOptionTextAndDataset(opt, beforeDisplayName);
      window.currentSheetDisplayName = beforeDisplayName;
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
        // Some flows rebuild the <select>; re-sync at click time.
        syncCurrentFromSelect();
        if (!(window.currentSheetId != null)) return;
        updateSheetRenameView("edit");
      },
      { passive: true }
    );

    label.addEventListener(
      "click",
      () => {
        syncCurrentFromSelect();
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
      const spreadsheetId = ctx.spreadsheetId || window.currentSpreadsheetId || window.__LM_ACTIVE_SPREADSHEET_ID;
      const sel2 = findSheetSelect();
      if (spreadsheetId && sel2) {
        // Best-effort: update option labels from registry (if available).
        syncDisplayNamesFromZ1(spreadsheetId, null, sel2).catch(() => {});
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
    //   (spreadsheetId, sheetsArray, selectEl)
    //   (spreadsheetId, authFetch, selectEl)  // legacy
    let sheets = null;
    let selectEl = null;

    // legacy: (spreadsheetId, authFetch, selectEl)
    if (a && typeof a === "function") {
      selectEl = b;
      // We no longer need authFetch here; registry reads go through __lm_fetchJSONAuth internally.
      sheets = null;
    } else if (Array.isArray(a)) {
      sheets = a;
      selectEl = b;
    } else {
      selectEl = a;
      sheets = null;
    }

    if (!selectEl) selectEl = findSheetSelect();
    return syncDisplayNamesFromZ1(spreadsheetId, sheets, selectEl);
  };

  // for manual debugging
  window.__lm_applySheetRename = applySheetRename;


  // Registry helpers for other modules (e.g., caption.sheet.selector.js)
  window.__lm_getSheetNameRegistry = async function ({ spreadsheetId } = {}) {
    if (!spreadsheetId) {
      spreadsheetId =
        window.__LM_ACTIVE_SPREADSHEET_ID ||
        window.currentSpreadsheetId ||
        (window.__lm_ctx && window.__lm_ctx.spreadsheetId) ||
        "";
    }
    if (!spreadsheetId) return { rows: [], gidToDisplayName: new Map(), gidToTitle: new Map() };
    return readSheetNameRegistry(spreadsheetId);
  };

  window.__lm_upsertSheetNameRegistry = async function ({ spreadsheetId, sheetGid, displayName, sheetTitle } = {}) {
    if (!spreadsheetId) {
      spreadsheetId =
        window.__LM_ACTIVE_SPREADSHEET_ID ||
        window.currentSpreadsheetId ||
        (window.__lm_ctx && window.__lm_ctx.spreadsheetId) ||
        "";
    }
    if (!spreadsheetId || sheetGid == null || !displayName) return false;
    await upsertSheetNameRegistry(spreadsheetId, sheetGid, displayName, sheetTitle || "");
    return true;
  };

  // optional export for manual re-mount
  window.mountSheetRenameUI = mountSheetRenameUI;
})();